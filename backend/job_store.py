from __future__ import annotations

import asyncio
import json
import logging
import os
import hashlib
from collections import Counter
from datetime import datetime, timezone
from typing import Any

try:
    import redis as redis_sync
except Exception:  # pragma: no cover - redis package may be unavailable in partial local setups
    redis_sync = None

log = logging.getLogger("nexus.job_store")

JOB_RUNTIME_STATE: dict[str, dict[str, Any]] = {}
JOB_RUNTIME_EVENTS: dict[str, list[dict[str, Any]]] = {}
JOB_LOCK = asyncio.Lock()
JOB_REDIS_PREFIX = "nexus:job"
_SYNC_REDIS_URL_CACHE: str | None = None
_SYNC_REDIS_CLIENT: Any = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_state_key(job_id: str) -> str:
    return f"{JOB_REDIS_PREFIX}:state:{job_id}"


def _job_events_key(job_id: str) -> str:
    return f"{JOB_REDIS_PREFIX}:events:{job_id}"


def _job_index_key() -> str:
    return f"{JOB_REDIS_PREFIX}:index"


def _serialize_payload(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _deserialize_payload(raw: Any) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _parse_iso(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _seconds_since(value: Any, now: datetime) -> int | None:
    parsed = _parse_iso(value)
    if not parsed:
        return None
    return max(int((now - parsed).total_seconds()), 0)


def _seconds_between(start_value: Any, end_value: Any) -> int | None:
    start = _parse_iso(start_value)
    end = _parse_iso(end_value)
    if not start or not end:
        return None
    return max(int((end - start).total_seconds()), 0)


def _runner_name(current: dict[str, Any]) -> str:
    if current.get("celery_task_id"):
        return "celery"
    return str(current.get("runner") or "local_async")


def _build_job_snapshot(current: dict[str, Any], events: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    snapshot = dict(current)
    recent_events = events[-3:]
    last_event = recent_events[-1] if recent_events else None
    finished_at = snapshot.get("finished_at")
    if not finished_at and str(snapshot.get("status") or "").lower() in {"completed", "failed", "cancelled"}:
        finished_at = snapshot.get("updated_at")

    snapshot["runner"] = _runner_name(snapshot)
    snapshot["event_count"] = len(events)
    snapshot["last_event_type"] = snapshot.get("last_event_type") or (last_event or {}).get("event_type")
    snapshot["current_stage"] = snapshot.get("current_stage") or snapshot.get("last_event_type") or snapshot.get("status") or "unknown"
    snapshot["recent_events"] = [
        {
            "event_type": event.get("event_type"),
            "created_at": event.get("created_at"),
        }
        for event in recent_events
    ]
    snapshot["updated_seconds_ago"] = _seconds_since(snapshot.get("updated_at"), now)
    snapshot["queued_seconds"] = _seconds_since(snapshot.get("created_at"), now)
    snapshot["runtime_seconds"] = _seconds_between(snapshot.get("started_at"), finished_at or now.isoformat())
    snapshot["finished_at"] = finished_at
    snapshot["speed"] = snapshot.get("speed")
    snapshot["eta"] = snapshot.get("eta")
    snapshot["progress_percent"] = snapshot.get("progress", 0)
    return snapshot


def _get_supabase():
    try:
        from backend.auth import supabase

        return supabase
    except Exception:
        return None


async def _get_async_redis_client():
    try:
        from backend.api_v1.middleware import _get_redis_client

        return _get_redis_client()
    except Exception:
        return None


def _get_sync_redis_client():
    global _SYNC_REDIS_URL_CACHE, _SYNC_REDIS_CLIENT
    redis_url = os.environ.get("REDIS_URL")
    if redis_url != _SYNC_REDIS_URL_CACHE:
        _SYNC_REDIS_URL_CACHE = redis_url
        _SYNC_REDIS_CLIENT = None
        if redis_url and redis_sync is not None:
            try:
                _SYNC_REDIS_CLIENT = redis_sync.from_url(redis_url, decode_responses=True)
            except Exception as exc:
                log.debug("Skipping sync Redis job client init for %s: %s", redis_url, exc)
                _SYNC_REDIS_CLIENT = None
    return _SYNC_REDIS_CLIENT


async def _persist_job_state(job_id: str, current: dict[str, Any]) -> None:
    redis_client = await _get_async_redis_client()
    if redis_client is None:
        return
    try:
        await redis_client.set(_job_state_key(job_id), _serialize_payload(current))
        updated_at = _parse_iso(current.get("updated_at")) or datetime.now(timezone.utc)
        await redis_client.zadd(_job_index_key(), {job_id: updated_at.timestamp()})
    except Exception as exc:
        log.debug("Skipping Redis job state sync for %s: %s", job_id, exc)


def _persist_job_state_sync(job_id: str, current: dict[str, Any]) -> None:
    redis_client = _get_sync_redis_client()
    if redis_client is None:
        return
    try:
        redis_client.set(_job_state_key(job_id), _serialize_payload(current))
        updated_at = _parse_iso(current.get("updated_at")) or datetime.now(timezone.utc)
        redis_client.zadd(_job_index_key(), {job_id: updated_at.timestamp()})
    except Exception as exc:
        log.debug("Skipping sync Redis job state write for %s: %s", job_id, exc)


async def _persist_job_event(entry: dict[str, Any]) -> None:
    redis_client = await _get_async_redis_client()
    if redis_client is None:
        return
    try:
        await redis_client.rpush(_job_events_key(str(entry.get("job_id"))), _serialize_payload(entry))
        await redis_client.ltrim(_job_events_key(str(entry.get("job_id"))), -100, -1)
    except Exception as exc:
        log.debug("Skipping Redis job event sync for %s: %s", entry.get("job_id"), exc)


async def _load_job_state(job_id: str) -> dict[str, Any] | None:
    redis_client = await _get_async_redis_client()
    if redis_client is not None:
        try:
            payload = _deserialize_payload(await redis_client.get(_job_state_key(job_id)))
            if payload:
                return payload
        except Exception as exc:
            log.debug("Skipping Redis job state read for %s: %s", job_id, exc)

    async with JOB_LOCK:
        current = JOB_RUNTIME_STATE.get(job_id)
        return dict(current) if current else None


async def _load_job_events(job_id: str, limit: int = 3) -> list[dict[str, Any]]:
    redis_client = await _get_async_redis_client()
    if redis_client is not None:
        try:
            raw_entries = await redis_client.lrange(_job_events_key(job_id), max(-limit, -100), -1)
            events = [_deserialize_payload(item) for item in raw_entries]
            return [event for event in events if event]
        except Exception as exc:
            log.debug("Skipping Redis job events read for %s: %s", job_id, exc)

    async with JOB_LOCK:
        return list(JOB_RUNTIME_EVENTS.get(job_id, []))[-limit:]


async def _list_recent_job_ids(limit: int = 50) -> list[str]:
    redis_client = await _get_async_redis_client()
    if redis_client is not None:
        try:
            ids = await redis_client.zrevrange(_job_index_key(), 0, max(limit - 1, 0))
            if ids:
                return [str(item) for item in ids]
        except Exception as exc:
            log.debug("Skipping Redis job index read: %s", exc)

    async with JOB_LOCK:
        jobs = list(JOB_RUNTIME_STATE.values())
    jobs.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return [str(item.get("id")) for item in jobs[:limit] if item.get("id")]


async def register_job(job_id: str, payload: dict[str, Any]) -> None:
    async with JOB_LOCK:
        JOB_RUNTIME_STATE[job_id] = {
            "id": job_id,
            **payload,
            "runner": payload.get("runner") or "local_async",
            "current_stage": "created",
            "event_count": 0,
            "last_event_type": None,
            "started_at": payload.get("started_at"),
            "finished_at": payload.get("finished_at"),
            "updated_at": _utc_now(),
        }
        JOB_RUNTIME_EVENTS[job_id] = []

    await _persist_job_state(job_id, JOB_RUNTIME_STATE[job_id])
    await add_job_event(job_id, "created", {"payload": payload})
    await _sync_job_row(job_id)


async def update_job(job_id: str, **updates: Any) -> None:
    async with JOB_LOCK:
        current = JOB_RUNTIME_STATE.get(job_id, {"id": job_id})
        previous_status = str(current.get("status") or "").lower()
        current.update(updates)
        status = str(current.get("status") or "").lower()
        now = _utc_now()
        current.setdefault("runner", "local_async")
        current.setdefault("created_at", now)
        if status in {"downloading", "processing"} and not current.get("started_at"):
            current["started_at"] = now
        if status in {"completed", "failed", "cancelled"}:
            current["finished_at"] = current.get("finished_at") or now
        if status and status != previous_status:
            current["status_changed_at"] = now
        if "progress" in updates:
            current["progress_percent"] = current.get("progress", 0)
        current["updated_at"] = _utc_now()
        JOB_RUNTIME_STATE[job_id] = current

    await _persist_job_state(job_id, current)
    await _sync_job_row(job_id)


async def add_job_event(job_id: str, event_type: str, payload: dict[str, Any] | None = None) -> None:
    entry = {
        "job_id": job_id,
        "event_type": event_type,
        "payload": payload or {},
        "created_at": _utc_now(),
    }
    async with JOB_LOCK:
        events = JOB_RUNTIME_EVENTS.setdefault(job_id, [])
        events.append(entry)
        current = JOB_RUNTIME_STATE.setdefault(job_id, {"id": job_id})
        current["last_event_type"] = event_type
        current["current_stage"] = event_type
        current["event_count"] = len(events)
        if event_type in {"download_started", "processing"} and not current.get("started_at"):
            current["started_at"] = entry["created_at"]
        if event_type in {"completed", "failed", "cancelled"}:
            current["finished_at"] = entry["created_at"]
        current["updated_at"] = entry["created_at"]
        current_state = dict(current)
    await _persist_job_event(entry)
    await _persist_job_state(job_id, current_state)
    await _sync_job_event(entry)


async def get_job(job_id: str) -> dict[str, Any] | None:
    return await _load_job_state(job_id)


def _dedupe_key(user_id: Any, normalized_url: str, format_id: Any) -> str:
    raw = f"{user_id or 'anon'}|{normalized_url}|{format_id}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"{JOB_REDIS_PREFIX}:dedupe:{digest}"


async def claim_or_find_active_download(
    user_id: Any,
    normalized_url: str,
    format_id: Any,
    job_id: str,
    ttl_seconds: int = 600,
) -> str | None:
    """Concurrency guard for identical downloads.

    Atomically claims a dedupe slot for (user, url, format). Returns ``None`` if
    this caller won the slot (proceed normally). If an identical job is already
    in flight, returns that job's id so the caller can return it instead of
    queuing a redundant download. A prior job that already finished/failed does
    not block — the slot is taken over.
    """
    redis_client = await _get_async_redis_client()
    if redis_client is None:
        # No shared store: cannot coordinate across workers; allow the download.
        return None
    key = _dedupe_key(user_id, normalized_url, format_id)
    try:
        claimed = await redis_client.set(key, job_id, nx=True, ex=ttl_seconds)
        if claimed:
            return None
        existing_job_id = await redis_client.get(key)
        if not existing_job_id:
            await redis_client.set(key, job_id, ex=ttl_seconds)
            return None
        existing_job_id = str(existing_job_id)
        existing = await _load_job_state(existing_job_id)
        status = str((existing or {}).get("status") or "").lower()
        if status in {"queued", "downloading", "processing"}:
            return existing_job_id
        # Prior job is terminal/unknown — take over the slot.
        await redis_client.set(key, job_id, ex=ttl_seconds)
        return None
    except Exception as exc:
        log.debug("Download dedupe check skipped for %s: %s", key, exc)
        return None


async def release_download_claim(user_id: Any, normalized_url: str, format_id: Any) -> None:
    """Release a dedupe slot early (otherwise it expires via TTL)."""
    redis_client = await _get_async_redis_client()
    if redis_client is None:
        return
    try:
        await redis_client.delete(_dedupe_key(user_id, normalized_url, format_id))
    except Exception as exc:
        log.debug("Download dedupe release skipped: %s", exc)


def is_job_cancel_requested(job_id: str) -> bool:
    current = JOB_RUNTIME_STATE.get(job_id) or {}
    if current.get("cancel_requested"):
        return True

    redis_client = _get_sync_redis_client()
    if redis_client is None:
        return False
    try:
        payload = _deserialize_payload(redis_client.get(_job_state_key(job_id))) or {}
        return bool(payload.get("cancel_requested"))
    except Exception:
        return False


async def list_recent_jobs(limit: int = 50) -> list[dict[str, Any]]:
    job_ids = await _list_recent_job_ids(limit)
    now = datetime.now(timezone.utc)
    snapshots: list[dict[str, Any]] = []
    for job_id in job_ids:
        state = await _load_job_state(job_id)
        if not state:
            continue
        events = await _load_job_events(job_id, limit=3)
        snapshots.append(_build_job_snapshot(dict(state), events, now))
    return snapshots[:limit]


async def summarize_jobs() -> dict[str, Any]:
    jobs = await list_recent_jobs(limit=500)
    status_counter = Counter(str(item.get("status") or "unknown") for item in jobs)
    queue_counter = Counter(str(item.get("queue_name") or "unknown") for item in jobs)
    stage_counter = Counter(str(item.get("current_stage") or "unknown") for item in jobs)
    runner_counter = Counter(str(item.get("runner") or "unknown") for item in jobs)
    active_jobs = [item for item in jobs if item.get("status") in {"queued", "downloading", "processing"}]
    active_progress = [int(item.get("progress") or 0) for item in active_jobs]

    return {
        "total_jobs": len(jobs),
        "active_jobs": len(active_jobs),
        "statuses": dict(status_counter),
        "queues": dict(queue_counter),
        "stages": dict(stage_counter),
        "runners": dict(runner_counter),
        "avg_active_progress": round(sum(active_progress) / len(active_progress), 2) if active_progress else 0,
        "recent_jobs": jobs[:20],
    }


def set_job_progress(job_id: str, percent: int, speed: str | None, eta: str | None) -> None:
    current = JOB_RUNTIME_STATE.get(job_id, {"id": job_id})
    if not current.get("started_at"):
        current["started_at"] = _utc_now()
    current["progress"] = percent
    current["progress_percent"] = percent
    current["speed"] = speed
    current["eta"] = eta
    current["updated_at"] = _utc_now()
    JOB_RUNTIME_STATE[job_id] = current
    _persist_job_state_sync(job_id, current)


async def _sync_job_row(job_id: str) -> None:
    supabase = _get_supabase()
    if not supabase:
        return

    current = await get_job(job_id)
    if not current:
        return

    payload = {
        "id": current.get("id"),
        "user_id": current.get("user_id"),
        "source_channel": current.get("source_channel"),
        "provider": current.get("provider"),
        "normalized_url": current.get("normalized_url"),
        "requested_format_id": current.get("requested_format_id"),
        "requested_media_type": current.get("requested_media_type"),
        "queue_name": current.get("queue_name"),
        "priority": current.get("priority"),
        "status": current.get("status"),
        "progress_percent": current.get("progress", 0),
        "failure_code": current.get("code"),
        "failure_reason": current.get("error"),
        "result_asset_id": current.get("filename"),
        "updated_at": current.get("updated_at"),
        "created_at": current.get("created_at") or current.get("updated_at"),
    }

    def _write() -> None:
        try:
            existing = supabase.table("jobs").select("id").eq("id", job_id).maybe_single().execute()
            if existing.data:
                supabase.table("jobs").update(payload).eq("id", job_id).execute()
            else:
                supabase.table("jobs").insert(payload).execute()
        except Exception as exc:
            log.debug("Skipping jobs sync for %s: %s", job_id, exc)

    await asyncio.to_thread(_write)


async def _sync_job_event(entry: dict[str, Any]) -> None:
    supabase = _get_supabase()
    if not supabase:
        return

    def _write() -> None:
        try:
            supabase.table("job_events").insert(entry).execute()
        except Exception as exc:
            log.debug("Skipping job_events sync for %s: %s", entry.get("job_id"), exc)

    await asyncio.to_thread(_write)
