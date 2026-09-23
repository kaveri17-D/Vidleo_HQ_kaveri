from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any, Optional

from backend.download_handler import create_temp_output, download_selected_media
from backend.entitlements import build_effective_entitlement
from backend.extractor_service import (
    MediaExtractionError,
    extract_media_info,
    get_cached_probe_payload,
    get_provider_name,
)
from backend.format_parser import MAX_DISCORD_BYTES, MAX_TELEGRAM_BYTES, build_format_catalog, find_format_option
from backend.job_store import add_job_event, is_job_cancel_requested, set_job_progress, update_job
from backend.storage_handler import create_delivery_artifact

log = logging.getLogger("nexus.job_runner")


async def run_download_job_async(job_id: str, payload: dict[str, Any], user: dict[str, Any]) -> None:
    temp_dir: Optional[str] = None
    try:
        await _ensure_not_cancelled(job_id)
        url = str(payload["url"])
        format_id = str(payload["format_id"])
        format_type = str(payload.get("format_type") or "video")
        filename = payload.get("filename")
        delivery_target = str(payload.get("delivery_target") or "web")
        resolved_title = payload.get("resolved_title")
        download_selector = payload.get("download_selector")
        cached_info: Optional[dict[str, Any]] = None

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
            entitlement = user.get("entitlement") or build_effective_entitlement(user)
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
        )
        await _ensure_not_cancelled(job_id)

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

        if should_fallback:
            artifact = create_delivery_artifact(
                file_path=output_path,
                filename=output_path.name,
                job_id=job_id,
                retention_hours=int(entitlement.get("retention_hours") or 24),
                base_url=os.environ.get("NEXUS_WEB_URL"),
            )
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
                expires_at=artifact.expires_at,
            )
            await add_job_event(job_id, "fallback_uploaded", {"url": artifact.url, "mode": artifact.mode})
            await add_job_event(job_id, "completed", {"fallback_url": artifact.url})
            
            user_id = user.get("id")
            if user_id and not user.get("anonymous"):
                from backend.middleware.credit_gate import commit_credits
                await commit_credits(user_id, job_id, cost=1)
                
            return

        await update_job(
            job_id,
            status="completed",
            progress=100,
            path=str(output_path),
            filename=output_path.name,
            size_bytes=size_bytes,
            download_url=f"/download/file/{job_id}",
            delivery_mode="direct_file",
        )
        await add_job_event(job_id, "completed", {"download_url": f"/download/file/{job_id}"})
        
        user_id = user.get("id")
        if user_id and not user.get("anonymous"):
            from backend.middleware.credit_gate import commit_credits
            await commit_credits(user_id, job_id, cost=1)
    except MediaExtractionError as exc:
        if exc.code == "cancelled":
            user_id = user.get("id")
            if user_id and not user.get("anonymous"):
                from backend.middleware.credit_gate import refund_credits
                await refund_credits(user_id, job_id, cost=1)
            _cleanup_temp(temp_dir)
            return
        await update_job(
            job_id,
            status="failed",
            error=str(exc),
            code=exc.code,
            error_status_code=exc.status_code,
        )
        await add_job_event(job_id, "failed", {"code": exc.code, "error": str(exc)})
        
        user_id = user.get("id")
        if user_id and not user.get("anonymous"):
            from backend.middleware.credit_gate import refund_credits
            await refund_credits(user_id, job_id, cost=1)
            
        _cleanup_temp(temp_dir)
    except Exception as exc:
        log.error("Queued job %s failed: %s", job_id, exc, exc_info=True)
        await update_job(
            job_id,
            status="failed",
            error="Download failed",
            code="download_failed",
            error_status_code=500,
        )
        await add_job_event(job_id, "failed", {"code": "download_failed", "error": str(exc)})
        
        user_id = user.get("id")
        if user_id and not user.get("anonymous"):
            from backend.middleware.credit_gate import refund_credits
            await refund_credits(user_id, job_id, cost=1)
            
        _cleanup_temp(temp_dir)


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
