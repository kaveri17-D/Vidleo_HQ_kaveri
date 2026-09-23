from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import redis
from backend.supabase_client import Client, create_client

log = logging.getLogger("nexus.storage")

try:  # Optional dependency for real R2 presigned URLs
    import boto3  # type: ignore
except Exception:  # pragma: no cover
    boto3 = None


ARTIFACT_KEY_PREFIX = "fallback_artifact:"
_artifact_registry_url_cache: str | None = None
artifact_registry: redis.Redis | None = None
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
supabase: Client | None = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY) if SUPABASE_URL and SUPABASE_SERVICE_KEY else None


@dataclass
class DeliveryArtifact:
    mode: str
    url: str
    expires_at: str
    filename: str
    local_token: Optional[str] = None
    bucket_key: Optional[str] = None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _secret() -> bytes:
    return os.environ.get("SIGNED_DOWNLOAD_SECRET", "nexus-dev-secret").encode("utf-8")


def _sign_payload(payload: dict) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(_secret(), body, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(body + b"." + signature).decode("utf-8")


def _verify_token(token: str) -> dict | None:
    try:
        raw = base64.urlsafe_b64decode(token.encode("utf-8"))
        body, signature = raw.rsplit(b".", 1)
        expected = hmac.new(_secret(), body, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            return None
        return json.loads(body.decode("utf-8"))
    except Exception:
        return None


def is_r2_configured() -> bool:
    return bool(
        os.environ.get("R2_BUCKET")
        and os.environ.get("R2_ENDPOINT_URL")
        and os.environ.get("R2_ACCESS_KEY_ID")
        and os.environ.get("R2_SECRET_ACCESS_KEY")
    )


def _get_r2_client():
    if not boto3 or not is_r2_configured():
        return None

    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT_URL"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("R2_REGION", "auto"),
    )


def _safe_delete_path(path_value: str | None) -> None:
    if not path_value:
        return
    try:
        path = Path(path_value)
        if path.is_file():
            path.unlink(missing_ok=True)
        elif path.exists():
            import shutil

            shutil.rmtree(path, ignore_errors=True)
    except Exception as exc:
        log.warning("Failed to remove expired fallback path %s: %s", path_value, exc)


def _registry_key(token: str) -> str:
    return f"{ARTIFACT_KEY_PREFIX}{token}"


def _get_artifact_registry() -> redis.Redis | None:
    global _artifact_registry_url_cache, artifact_registry
    redis_url = os.environ.get("REDIS_URL")
    if redis_url != _artifact_registry_url_cache:
        _artifact_registry_url_cache = redis_url
        artifact_registry = None
        if redis_url:
            try:
                artifact_registry = redis.from_url(redis_url, decode_responses=True)
            except Exception as exc:  # pragma: no cover
                log.warning("Failed to initialize artifact Redis client for %s: %s", redis_url, exc)
                artifact_registry = None
    return artifact_registry


def _registry_status() -> dict[str, object]:
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        return {
            "registry_configured": False,
            "registry_available": False,
            "registry_mode": "disabled",
            "registry_detail": "REDIS_URL is not configured.",
        }
    registry = _get_artifact_registry()
    if registry is None:
        return {
            "registry_configured": True,
            "registry_available": False,
            "registry_mode": "degraded",
            "registry_detail": "Artifact Redis client initialization failed.",
        }
    try:
        registry.ping()
        return {
            "registry_configured": True,
            "registry_available": True,
            "registry_mode": "redis",
            "registry_detail": None,
        }
    except Exception as exc:
        return {
            "registry_configured": True,
            "registry_available": False,
            "registry_mode": "degraded",
            "registry_detail": str(exc),
        }


def _ensure_registry_or_fail() -> redis.Redis:
    registry = _get_artifact_registry()
    if registry is None:
        raise RuntimeError("Redis artifact registry is unavailable.")
    try:
        registry.ping()
    except Exception as exc:
        raise RuntimeError("Redis artifact registry is unavailable.") from exc
    return registry


def _record_delivery_incident(
    *,
    provider: str,
    incident_type: str,
    artifact_mode: str,
    job_id: str | None,
    filename: str | None,
    detail: str | None,
) -> None:
    if not supabase:
        return
    try:
        supabase.table("delivery_incidents").insert(
            {
                "provider": provider,
                "incident_type": incident_type,
                "artifact_mode": artifact_mode,
                "job_id": job_id,
                "filename": filename,
                "detail": detail,
                "created_at": _utc_now().isoformat(),
            }
        ).execute()
    except Exception as exc:
        log.debug("Skipping delivery incident sync for %s/%s: %s", provider, incident_type, exc)


def cleanup_expired_local_artifacts() -> int:
    status = _registry_status()
    if not status["registry_available"]:
        return 0
    registry = _ensure_registry_or_fail()
    expired_tokens: list[str] = []
    now = _utc_now()
    for key in registry.scan_iter(f"{ARTIFACT_KEY_PREFIX}*"):
        raw = registry.get(key)
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except Exception:
            expired_tokens.append(str(key).replace(ARTIFACT_KEY_PREFIX, "", 1))
            continue

        expires_at = payload.get("expires_at")
        if not expires_at:
            expired_tokens.append(str(key).replace(ARTIFACT_KEY_PREFIX, "", 1))
            continue
        try:
            expiry = datetime.fromisoformat(str(expires_at))
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            if expiry <= now:
                expired_tokens.append(str(key).replace(ARTIFACT_KEY_PREFIX, "", 1))
        except Exception:
            expired_tokens.append(str(key).replace(ARTIFACT_KEY_PREFIX, "", 1))

    removed = 0
    for token in expired_tokens:
        payload = resolve_local_artifact(token, skip_cleanup=True)
        registry.delete(_registry_key(token))
        if payload:
            _safe_delete_path(payload.get("temp_dir") or payload.get("path"))
        removed += 1
    return removed


def get_local_artifact_stats() -> dict[str, object]:
    status = _registry_status()
    if not status["registry_available"]:
        return {
            "active_local_artifacts": 0,
            "expired_local_artifacts": 0,
            "expiring_within_hour": 0,
            "next_expiry": None,
            **status,
        }

    registry = _ensure_registry_or_fail()
    now = _utc_now()
    active = 0
    expired = 0
    expiring_soon = 0
    next_expiry: str | None = None

    for key in registry.scan_iter(f"{ARTIFACT_KEY_PREFIX}*"):
        raw = registry.get(key)
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except Exception:
            expired += 1
            continue
        expires_at = payload.get("expires_at")
        if not expires_at:
            expired += 1
            continue
        try:
            expiry = datetime.fromisoformat(str(expires_at))
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
        except Exception:
            expired += 1
            continue
        if expiry <= now:
            expired += 1
            continue
        active += 1
        if expiry <= now + timedelta(hours=1):
            expiring_soon += 1
        if next_expiry is None or expiry.isoformat() < next_expiry:
            next_expiry = expiry.isoformat()

    return {
        "active_local_artifacts": active,
        "expired_local_artifacts": expired,
        "expiring_within_hour": expiring_soon,
        "next_expiry": next_expiry,
        **status,
    }


def create_delivery_artifact(
    *,
    file_path: Path,
    filename: str,
    job_id: str,
    retention_hours: int = 24,
    base_url: str | None = None,
) -> DeliveryArtifact:
    cleanup_expired_local_artifacts()
    expires_at = _utc_now() + timedelta(hours=retention_hours)

    r2_client = _get_r2_client()
    if r2_client:
        try:
            bucket = os.environ["R2_BUCKET"]
            object_key = f"nexus-fallback/{job_id}/{filename}"
            extra_args = {}
            content_type = _guess_content_type(filename)
            if content_type:
                extra_args["ContentType"] = content_type
            r2_client.upload_file(str(file_path), bucket, object_key, ExtraArgs=extra_args or None)
            url = r2_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": object_key},
                ExpiresIn=max(60, retention_hours * 3600),
            )
            return DeliveryArtifact(
                mode="r2_signed",
                url=url,
                expires_at=expires_at.isoformat(),
                filename=filename,
                bucket_key=object_key,
            )
        except Exception as exc:
            log.warning("R2 fallback upload failed for %s: %s", job_id, exc)
            _record_delivery_incident(
                provider="r2",
                incident_type="upload_failed",
                artifact_mode="r2_signed",
                job_id=job_id,
                filename=filename,
                detail=str(exc),
            )

    try:
        registry = _ensure_registry_or_fail()
    except RuntimeError as exc:
        _record_delivery_incident(
            provider="redis_registry",
            incident_type="registry_unavailable",
            artifact_mode="local_signed",
            job_id=job_id,
            filename=filename,
            detail=str(exc),
        )
        raise
    payload = {
        "job_id": job_id,
        "filename": filename,
        "path": str(file_path),
        "temp_dir": str(file_path.parent),
        "expires_at": expires_at.isoformat(),
    }
    token = _sign_payload(payload)
    ttl_seconds = max(60, int((expires_at - _utc_now()).total_seconds()))
    registry.setex(_registry_key(token), ttl_seconds, json.dumps(payload))

    if base_url:
        url = f"{base_url.rstrip('/')}/api/fallback/{token}"
    else:
        url = f"/api/fallback/{token}"

    return DeliveryArtifact(
        mode="local_signed",
        url=url,
        expires_at=expires_at.isoformat(),
        filename=filename,
        local_token=token,
    )


def resolve_local_artifact(token: str, *, skip_cleanup: bool = False) -> dict | None:
    if not skip_cleanup:
        cleanup_expired_local_artifacts()
    if not _registry_status()["registry_available"]:
        return None
    registry = _ensure_registry_or_fail()
    raw = registry.get(_registry_key(token))
    payload = json.loads(raw) if raw else None

    if not payload:
        payload = _verify_token(token)
        if payload:
            expires_at = payload.get("expires_at")
            try:
                expiry = datetime.fromisoformat(str(expires_at))
                if expiry.tzinfo is None:
                    expiry = expiry.replace(tzinfo=timezone.utc)
                ttl_seconds = max(1, int((expiry - _utc_now()).total_seconds()))
                registry.setex(_registry_key(token), ttl_seconds, json.dumps(payload))
            except Exception:
                payload = None

    if not payload:
        return None

    expires_at = payload.get("expires_at")
    if not expires_at:
        registry.delete(_registry_key(token))
        return None

    try:
        expiry = datetime.fromisoformat(str(expires_at))
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry < _utc_now():
            registry.delete(_registry_key(token))
            _safe_delete_path(payload.get("temp_dir") or payload.get("path"))
            return None
    except Exception:
        registry.delete(_registry_key(token))
        return None

    path = Path(str(payload.get("path") or ""))
    if not path.exists():
        registry.delete(_registry_key(token))
        return None

    return payload


def _guess_content_type(filename: str) -> Optional[str]:
    lowered = filename.lower()
    if lowered.endswith(".mp4"):
        return "video/mp4"
    if lowered.endswith(".mp3"):
        return "audio/mpeg"
    if lowered.endswith(".m4a"):
        return "audio/mp4"
    if lowered.endswith(".webm"):
        return "video/webm"
    return None
