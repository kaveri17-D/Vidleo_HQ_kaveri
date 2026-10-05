"""
NEXUS Phase 5 — Stranded Credit Reservation Reaper
====================================================

Problem
-------
When a Celery worker is killed with SIGKILL mid-download, the credit
reservation stored at `tenant:{user_id}:reserved` is never released.
The user's `available` balance remains permanently reduced.

Solution
--------
`run_reservation_reaper()` is called from `_billing_reconciliation_loop()`
(already in main.py) and from `startup_reconciliation()`.

It scans all `tenant:*:reserved` hashes in Redis.  For each entry:
  - Parses the stored value: `{cost}:{iso_timestamp}`.
  - If the timestamp is older than `REAPER_STALE_AGE_SECONDS` (default 1800 s):
      - Looks up the job in Supabase.
      - If the job is terminal (completed/failed/cancelled/missing):
          → calls `refund_credits()` to release the reservation.
      - If the job is still active (queued/downloading/processing):
          → leaves the reservation alone (job is healthy).

Concurrency safety
------------------
Multiple API processes can run this reaper concurrently.  `refund_credits()`
checks `HGET reserved job_id` before acting, so double-refunds are prevented.

Disabling
---------
Set `NEXUS_RESERVATION_REAPER_ENABLED=0` to disable.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger("nexus.reservation_reaper")

REAPER_STALE_AGE_SECONDS = int(os.environ.get("NEXUS_REAPER_STALE_AGE_SECONDS", "1800"))  # 30 min
REAPER_ENABLED = os.environ.get("NEXUS_RESERVATION_REAPER_ENABLED", "1") != "0"

_ACTIVE_STATUSES = frozenset({"queued", "extracting", "downloading", "processing", "uploading"})


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        val_str = str(value).strip()
        if val_str.isdigit():
            return datetime.fromtimestamp(int(val_str), tz=timezone.utc)
        return datetime.fromisoformat(val_str.replace("Z", "+00:00"))
    except Exception:
        return None


def _get_supabase():
    try:
        from backend.auth import supabase
        return supabase
    except Exception:
        return None


async def _job_status_from_db(job_id: str) -> str | None:
    """Return terminal/active status string from Supabase, or None if not found."""
    supabase = _get_supabase()
    if not supabase:
        return None
    try:
        res = await asyncio.to_thread(
            lambda: supabase.table("jobs")
                .select("status")
                .eq("id", job_id)
                .maybe_single()
                .execute()
        )
        return str((res.data or {}).get("status") or "").lower() or None
    except Exception as exc:
        log.debug("Reaper: DB status lookup failed for job %s: %s", job_id, exc)
        return None


async def run_reservation_reaper() -> dict[str, Any]:
    """
    Scan Redis reserved hashes and release stale reservations.
    Returns a summary dict suitable for logging.
    """
    if not REAPER_ENABLED:
        return {"status": "disabled"}

    try:
        from backend.api_v1.middleware import _get_redis_client
        redis_client = _get_redis_client()
    except Exception:
        redis_client = None

    if redis_client is None:
        return {"status": "skip", "reason": "redis_unavailable"}

    try:
        from backend.middleware.credit_gate import refund_credits
    except Exception as exc:
        return {"status": "error", "reason": f"import_failed: {exc}"}

    now = _utc_now()
    scanned = 0
    released = 0
    skipped_active = 0
    errors = 0

    try:
        # Scan all reservation hashes: tenant:*:reserved
        async for key in redis_client.scan_iter("tenant:*:reserved"):
            key_str = str(key)
            # Extract user_id from key pattern: tenant:{user_id}:reserved
            parts = key_str.split(":")
            if len(parts) != 3:
                continue
            user_id = parts[1]

            try:
                entries = await redis_client.hgetall(key_str)
            except Exception as exc:
                log.debug("Reaper: hgetall failed for %s: %s", key_str, exc)
                errors += 1
                continue

            for job_id, raw_value in (entries or {}).items():
                scanned += 1
                # Parse stored value: "{cost}:{iso_timestamp}" or legacy "{cost}"
                raw_str = str(raw_value or "")
                cost = 1
                reserved_at: datetime | None = None
                if ":" in raw_str:
                    cost_str, ts_str = raw_str.split(":", 1)
                    try:
                        cost = int(cost_str)
                    except ValueError:
                        cost = 1
                    reserved_at = _parse_iso(ts_str)
                else:
                    # Legacy format: just the cost integer
                    # We cannot determine age — assume stale if job is terminal
                    try:
                        cost = int(raw_str)
                    except ValueError:
                        cost = 1
                    reserved_at = None  # Will be determined by job status

                # Age gate: only act on entries older than REAPER_STALE_AGE_SECONDS
                if reserved_at is not None:
                    age_seconds = (now - reserved_at.astimezone(timezone.utc)).total_seconds()
                    if age_seconds < REAPER_STALE_AGE_SECONDS:
                        # Job might still be legitimately running
                        skipped_active += 1
                        continue

                # Check job status: from memory first, then Redis, then DB
                job_status: str | None = None
                try:
                    from backend.job_store import get_job
                    job = await get_job(job_id)
                    job_status = str((job or {}).get("status") or "").lower() or None
                except Exception:
                    pass

                if job_status is None:
                    job_status = await _job_status_from_db(job_id)

                if job_status and job_status in _ACTIVE_STATUSES:
                    # Job is still legitimately running
                    skipped_active += 1
                    continue

                # Job is terminal or missing — safe to release reservation
                log.info(
                    "Reaper: releasing stale reservation user=%s job=%s cost=%d status=%s age=%.0fs",
                    user_id, job_id, cost, job_status or "missing",
                    (now - reserved_at.astimezone(timezone.utc)).total_seconds()
                    if reserved_at else -1,
                )
                try:
                    await refund_credits(user_id, job_id, cost)
                    released += 1
                    try:
                        from backend.metrics import record_reservation_refund
                        record_reservation_refund(cost)
                    except Exception:
                        pass
                except Exception as exc:
                    log.warning("Reaper: refund failed for user=%s job=%s: %s", user_id, job_id, exc)
                    errors += 1

    except Exception as exc:
        log.warning("Reaper: scan failed: %s", exc)
        errors += 1

    log.info(
        "Reaper complete: scanned=%d released=%d skipped_active=%d errors=%d",
        scanned, released, skipped_active, errors,
    )
    return {
        "status": "ok",
        "scanned": scanned,
        "released": released,
        "skipped_active": skipped_active,
        "errors": errors,
    }
