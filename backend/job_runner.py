from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from backend.download_handler import create_temp_output, download_selected_media, validate_media_integrity
from backend.entitlements import build_effective_entitlement
from backend.extractor_service import (
    MediaExtractionError,
    extract_media_info,
    get_cached_probe_payload,
    get_provider_name,
)
from backend.format_parser import MAX_DISCORD_BYTES, MAX_TELEGRAM_BYTES, build_format_catalog, find_format_option
from backend.job_store import add_job_event, is_job_cancel_requested, set_job_progress, update_job
from backend.storage_handler import (
    create_delivery_artifact,
    is_r2_configured,
    is_enforce_object_storage,
    ObjectStorageRequiredError,
)

log = logging.getLogger("nexus.job_runner")


def scrub_error(msg: str | None) -> str:
    """
    Redact secrets, tokens, cookie payloads, and proxy credentials from error strings.
    Prevents sensitive backend internals or credentials leaking into client error logs.
    """
    if not msg:
        return "Unknown error"
    scrubbed = str(msg)
    # Redact http proxy credentials: http://user:pass@host -> http://***:***@host
    scrubbed = re.sub(r"://([^:@\s]+):([^@\s]+)@", r"://***:***@", scrubbed)
    # Redact query params that look like tokens or signatures
    scrubbed = re.sub(
        r"([?&](?:token|sig|signature|key|auth|secret|password|access_token)=)[^&\s]+",
        r"\1***",
        scrubbed,
        flags=re.IGNORECASE,
    )
    # Redact bearer tokens
    scrubbed = re.sub(r"Bearer\s+[a-zA-Z0-9_\-\.]+", "Bearer ***", scrubbed, flags=re.IGNORECASE)
    return scrubbed[:500]


async def run_download_job_async(job_id: str, payload: dict[str, Any], user: dict[str, Any]) -> None:
    temp_dir: Optional[str] = None
    start_time = datetime.now(timezone.utc)
    try:
        await _ensure_not_cancelled(job_id)

        # ── Phase 6 P2.3: Worker Pre-Execution Gate & Slot Reservation ───────
        from backend.admission_control import (
            is_resource_admission_enabled,
            try_reserve_worker_execution_slot,
        )
        if is_resource_admission_enabled():
            reserved, reserve_reason = try_reserve_worker_execution_slot(job_id)
            if not reserved:
                log.warning("Worker pre-execution gate deferred job %s: %s", job_id, reserve_reason)
                user_id = user.get("id")
                if user_id and not user.get("anonymous"):
                    from backend.middleware.credit_gate import refund_credits
                    await refund_credits(user_id, job_id, cost=1)
                await update_job(
                    job_id,
                    status="failed",
                    error=f"RESOURCE_ADMISSION_DEFERRED: {reserve_reason}",
                    failed_at=datetime.now(timezone.utc).isoformat(),
                )
                await add_job_event(job_id, "deferred", {"reason": reserve_reason})
                try:
                    from backend.metrics import record_resource_admission_deferred
                    record_resource_admission_deferred(reserve_reason.split(" ")[0])
                except Exception:
                    pass
                return

        url = str(payload["url"])
        format_id = str(payload["format_id"])
        format_type = str(payload.get("format_type") or "video")
        filename = payload.get("filename")
        delivery_target = str(payload.get("delivery_target") or "web")
        resolved_title = payload.get("resolved_title")
        download_selector = payload.get("download_selector")
        cached_info: Optional[dict[str, Any]] = None
        entitlement = user.get("entitlement") or build_effective_entitlement(user)

        if download_selector:
            await add_job_event(
                job_id,
                "probe_reused",
                {"url": url, "provider": payload.get("provider") or get_provider_name(url), "format_id": format_id},
            )
            # The dispatcher already probed (proxied for YouTube). Reuse the
            # cached info so download_handler can pass --load-info-json and
            # skip a second extraction roundtrip entirely.
            cached_info = await asyncio.to_thread(get_cached_probe_payload, url)
        else:
            await add_job_event(job_id, "probe_started", {"url": url, "provider": get_provider_name(url)})
            info = await asyncio.to_thread(extract_media_info, url, lightweight_probe=True)
            cached_info = info
            await _ensure_not_cancelled(job_id)
            include_owner_formats = bool(entitlement.get("4k_allowed") or user.get("is_owner"))
            catalog = build_format_catalog(info, include_owner_formats=include_owner_formats)
            choice = find_format_option(catalog, format_id, raw_info=info)
            if not choice:
                raise MediaExtractionError(f"Requested format '{format_id}' is not available", status_code=422, code="no_formats")
            download_selector = choice["download_selector"]
            resolved_title = resolved_title or info.get("title")

        temp_dir, output_template = create_temp_output(filename or resolved_title or "download")
        await update_job(job_id, status="downloading", progress=0, temp_dir=temp_dir)
        await add_job_event(job_id, "download_started", {"format_id": format_id, "type": format_type})

        def on_progress(snapshot) -> None:
            set_job_progress(job_id, snapshot.percent, snapshot.speed, snapshot.eta)

        output_path = await download_selected_media(
            url=url,
            selector=str(download_selector),
            format_type=format_type,
            output_template=output_template,
            progress_callback=on_progress,
            info=cached_info,
            job_id=job_id,  # Phase 5: process registry for real-time cancellation
        )
        await _ensure_not_cancelled(job_id)

        # Phase 10: Final Media Integrity Gate (FAIL_AV_SYNC detection)
        is_valid, validation_msg = await asyncio.to_thread(validate_media_integrity, output_path)
        if not is_valid:
            log.error("Job %s failed media integrity gate: %s", job_id, validation_msg)
            raise MediaExtractionError(f"Media validation failed: {validation_msg}", status_code=500, code="FAIL_AV_SYNC")

        await add_job_event(job_id, "delivery_ready", {"filename": output_path.name})

        # Increment daily usage count for authenticated user on successful download completion
        if not user.get("anonymous") and user.get("id"):
            from backend.auth import increment_user_download_count
            await increment_user_download_count(user.get("id"))

        size_bytes = output_path.stat().st_size
        should_fallback = (
            (delivery_target == "telegram" and size_bytes > MAX_TELEGRAM_BYTES)
            or (delivery_target == "discord" and size_bytes > MAX_DISCORD_BYTES)
        )
        use_shared_storage = (
            should_fallback
            or is_r2_configured()
            or is_enforce_object_storage()
        )

        if use_shared_storage:
            try:
                artifact = create_delivery_artifact(
                    file_path=output_path,
                    filename=output_path.name,
                    job_id=job_id,
                    retention_hours=int(entitlement.get("retention_hours") or 24),
                    base_url=os.environ.get("NEXUS_WEB_URL"),
                )
            except ObjectStorageRequiredError as oerr:
                log.error("Mandatory object storage upload failed for job %s: %s", job_id, oerr)
                user_id = user.get("id")
                if user_id and not user.get("anonymous"):
                    from backend.middleware.credit_gate import refund_credits
                    await refund_credits(user_id, job_id, cost=1)
                await update_job(
                    job_id,
                    status="failed",
                    error=f"OBJECT_STORAGE_UPLOAD_FAILED: {str(oerr)}",
                    failed_at=datetime.now(timezone.utc).isoformat(),
                )
                await add_job_event(job_id, "failed", {"error": "OBJECT_STORAGE_UPLOAD_FAILED"})
                _safe_cleanup(output_path.parent)
                return

            expires_at = artifact.expires_at
            await update_job(
                job_id,
                status="completed",
                progress=100,
                path=str(output_path),
                filename=output_path.name,
                size_bytes=size_bytes,
                download_url=artifact.url,
                fallback_url=artifact.url,
                delivery_mode=artifact.mode,
                bucket_key=artifact.bucket_key,
                expires_at=expires_at,
            )
            await add_job_event(job_id, "fallback_uploaded", {"url": artifact.url, "mode": artifact.mode, "bucket_key": artifact.bucket_key})
            await add_job_event(job_id, "completed", {"download_url": artifact.url, "bucket_key": artifact.bucket_key})

            # In multi-instance / R2 mode, worker cleans up local scratch file to preserve worker disk
            if artifact.mode == "r2_signed":
                try:
                    output_path.unlink(missing_ok=True)
                    if output_path.parent.exists() and not any(output_path.parent.iterdir()):
                        output_path.parent.rmdir()
                except Exception as exc:
                    log.debug("Local scratch cleanup skipped for %s: %s", job_id, exc)

            user_id = user.get("id")
            if user_id and not user.get("anonymous"):
                from backend.middleware.credit_gate import commit_credits
                await commit_credits(user_id, job_id, cost=1)
                log.info("Job credits committed: job_id=%s user_id=%s cost=1", job_id, user_id)

            elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
            log.info(
                "Job execution completed: job_id=%s delivery_mode=%s size_bytes=%d duration_sec=%.2f expires_at=%s",
                job_id, artifact.mode, size_bytes, elapsed, expires_at,
            )
            try:
                from backend.metrics import record_job_completed
                record_job_completed(strategy="server_fallback", provider=str(payload.get("provider") or "generic"))
            except Exception:
                pass
            try:
                from backend.circuit_breaker import record_success
                await record_success(provider=str(payload.get("provider") or "generic"))
            except Exception:
                pass
            return

        # Direct file delivery: establish artifact TTL based on user entitlement (Single-Node Dev only)
        retention_hours = int(entitlement.get("retention_hours") or 24)
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=retention_hours)).isoformat()

        await update_job(
            job_id,
            status="completed",
            progress=100,
            path=str(output_path),
            filename=output_path.name,
            size_bytes=size_bytes,
            download_url=f"/download/file/{job_id}",
            delivery_mode="direct_file",
            expires_at=expires_at,
        )
        await add_job_event(job_id, "completed", {"download_url": f"/download/file/{job_id}", "expires_at": expires_at})
        
        user_id = user.get("id")
        if user_id and not user.get("anonymous"):
            from backend.middleware.credit_gate import commit_credits
            await commit_credits(user_id, job_id, cost=1)
            log.info("Job credits committed: job_id=%s user_id=%s cost=1", job_id, user_id)

        elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
        log.info(
            "Job execution completed: job_id=%s delivery_mode=direct_file size_bytes=%d duration_sec=%.2f expires_at=%s",
            job_id, size_bytes, elapsed, expires_at,
        )
        try:
            from backend.metrics import record_job_completed
            record_job_completed(strategy="server_fallback", provider=str(payload.get("provider") or "generic"))
        except Exception:
            pass
        try:
            from backend.circuit_breaker import record_success
            await record_success(provider=str(payload.get("provider") or "generic"))
        except Exception:
            pass
    except MediaExtractionError as exc:
        if exc.code == "cancelled":
            user_id = user.get("id")
            if user_id and not user.get("anonymous"):
                from backend.middleware.credit_gate import refund_credits
                await refund_credits(user_id, job_id, cost=1)
            _cleanup_temp(temp_dir)
            log.info("Job execution cancelled: job_id=%s", job_id)
            try:
                from backend.metrics import record_job_cancelled
                record_job_cancelled()
            except Exception:
                pass
            return

        clean_error = scrub_error(str(exc))
        await update_job(
            job_id,
            status="failed",
            error=clean_error,
            code=exc.code,
            error_status_code=exc.status_code,
        )
        await add_job_event(job_id, "failed", {"code": exc.code, "error": clean_error})
        
        user_id = user.get("id")
        if user_id and not user.get("anonymous"):
            from backend.middleware.credit_gate import refund_credits
            await refund_credits(user_id, job_id, cost=1)
            
        _cleanup_temp(temp_dir)
        log.warning("Job execution failed: job_id=%s code=%s error=%s", job_id, exc.code, clean_error)
        try:
            from backend.metrics import record_job_failed
            record_job_failed(strategy="server_fallback", provider=str(payload.get("provider") or "generic"), failure_category=exc.code)
        except Exception:
            pass
        try:
            from backend.circuit_breaker import record_failure
            await record_failure(
                provider=str(payload.get("provider") or "generic"),
                code=exc.code,
                error=clean_error,
                status_code=exc.status_code,
            )
        except Exception:
            pass
    except Exception as exc:
        clean_error = scrub_error(str(exc))
        log.error("Queued job %s failed: %s", job_id, clean_error, exc_info=True)
        await update_job(
            job_id,
            status="failed",
            error="Download failed",
            code="download_failed",
            error_status_code=500,
        )
        await add_job_event(job_id, "failed", {"code": "download_failed", "error": clean_error})
        
        user_id = user.get("id")
        if user_id and not user.get("anonymous"):
            from backend.middleware.credit_gate import refund_credits
            await refund_credits(user_id, job_id, cost=1)
            
        _cleanup_temp(temp_dir)
        try:
            from backend.metrics import record_job_failed
            record_job_failed(strategy="server_fallback", provider=str(payload.get("provider") or "generic"), failure_category="download_failed")
        except Exception:
            pass
        try:
            from backend.circuit_breaker import record_failure
            await record_failure(
                provider=str(payload.get("provider") or "generic"),
                code="download_failed",
                error=clean_error,
                status_code=500,
            )
        except Exception:
            pass
    finally:
        try:
            from backend.admission_control import (
                deregister_active_job_admission,
                release_worker_execution_slot,
            )
            release_worker_execution_slot(job_id)
            await deregister_active_job_admission(job_id, user.get("id"))
        except Exception:
            pass


def run_download_job_sync(job_id: str, payload: dict[str, Any], user: dict[str, Any]) -> None:
    asyncio.run(run_download_job_async(job_id, payload, user))


async def _ensure_not_cancelled(job_id: str) -> None:
    if is_job_cancel_requested(job_id):
        await update_job(
            job_id,
            status="cancelled",
            error="Cancelled by owner",
            code="cancelled",
            error_status_code=409,
        )
        await add_job_event(job_id, "cancelled", {"code": "cancelled", "error": "Cancelled by owner"})
        raise MediaExtractionError("Cancelled by owner", status_code=409, code="cancelled")


def _cleanup_temp(path: Optional[str]) -> None:
    if not path:
        return
    try:
        target = Path(path)
        if target.exists():
            import shutil

            shutil.rmtree(target, ignore_errors=True)
    except Exception as exc:
        log.error("Failed to clean temp dir %s: %s", path, exc)
