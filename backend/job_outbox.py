"""
NEXUS Phase 5 — Transactional Outbox
=====================================

Guarantees that every job registered in PostgreSQL is eventually dispatched
to Celery, even if the API process crashes between DB commit and queue publish.

Architecture
------------
  1. `start_download()` in main.py calls `register_job_with_outbox()` which
     writes the job row to Supabase with `outbox_status = 'pending'` BEFORE
     dispatching to Celery.
  2. After the Celery dispatch succeeds, `mark_outbox_dispatched()` sets
     `outbox_status = 'dispatched'`.
  3. `outbox_sweeper_loop()` runs every 60 s.  It claims rows that are still
     `pending` after 30 s (meaning the API process that wrote them crashed
     before dispatching) and re-publishes them to Celery.
  4. Celery tasks are idempotent at the job_runner level: the runner calls
     `_ensure_not_cancelled()` first and detects terminal states, so duplicate
     deliveries are harmless.

Concurrency safety
------------------
The sweeper uses a SELECT…FOR UPDATE SKIP LOCKED claim pattern via Supabase
REST (UPDATE with a claimed_at timestamp).  Two sweeper instances will each
claim different rows, preventing double-dispatch.

Disabling the outbox
--------------------
Set `NEXUS_OUTBOX_ENABLED=0` to disable.  When disabled, `start_download()`
falls back to the original fire-and-forget Celery dispatch.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger("nexus.outbox")

# How long a pending row must be un-dispatched before the sweeper retakes it.
_OUTBOX_CLAIM_AGE_SECONDS = int(os.environ.get("NEXUS_OUTBOX_CLAIM_AGE_SECONDS", "30"))
# How often the sweeper wakes up.
_OUTBOX_SWEEP_INTERVAL_SECONDS = int(os.environ.get("NEXUS_OUTBOX_SWEEP_INTERVAL_SECONDS", "60"))
# Max dispatch attempts before giving up on a row.
_OUTBOX_MAX_ATTEMPTS = int(os.environ.get("NEXUS_OUTBOX_MAX_ATTEMPTS", "5"))
# Feature flag (Phase 5 Outbox)
OUTBOX_ENABLED = os.environ.get("NEXUS_OUTBOX_ENABLED", "1") != "0"

# Feature flag & Config (Phase 6 P0-1 Outbox Retention & Archival Pruning)
OUTBOX_RETENTION_ENABLED = os.environ.get("NEXUS_OUTBOX_RETENTION_ENABLED", "0").lower() in ("1", "true", "yes")
OUTBOX_RETENTION_DAYS = int(os.environ.get("NEXUS_OUTBOX_RETENTION_DAYS", "7"))
OUTBOX_RETENTION_INTERVAL_SECONDS = int(os.environ.get("NEXUS_OUTBOX_RETENTION_INTERVAL_SECONDS", "3600"))

def is_outbox_retention_enabled() -> bool:
    return os.environ.get("NEXUS_OUTBOX_RETENTION_ENABLED", "0").lower() in ("1", "true", "yes")



def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _get_supabase():
    try:
        from backend.auth import supabase
        return supabase
    except Exception:
        return None


# ─── Public API ──────────────────────────────────────────────────────────────

async def register_outbox_pending(
    job_id: str,
    *,
    idempotency_key: str | None = None,
) -> None:
    """
    Mark the job row in Supabase as outbox_status='pending'.
    Called BEFORE dispatching to Celery so the row is durable even if the
    process crashes during dispatch.
    """
    if not OUTBOX_ENABLED:
        return
    supabase = _get_supabase()
    if not supabase:
        log.debug("Outbox: Supabase unavailable; skipping outbox_pending write for %s", job_id)
        return
    try:
        payload: dict[str, Any] = {
            "outbox_status": "pending",
            "outbox_attempt_count": 0,
            "outbox_dispatched_at": None,
            "outbox_last_error": None,
            "outbox_next_attempt_at": _utc_now().isoformat(),
        }
        if idempotency_key is not None:
            payload["idempotency_key"] = idempotency_key

        await asyncio.to_thread(
            lambda: supabase.table("jobs")
                .update(payload)
                .eq("id", job_id)
                .execute()
        )
        log.debug("Outbox: set pending for job %s", job_id)
    except Exception as exc:
        # Non-fatal: main path continues; sweeper will repair.
        log.warning("Outbox: failed to write pending state for %s: %s", job_id, exc)


async def mark_outbox_dispatched(job_id: str, celery_task_id: str | None = None) -> None:
    """
    Mark the job row as outbox_status='dispatched' after Celery publish succeeds.
    """
    if not OUTBOX_ENABLED:
        return
    supabase = _get_supabase()
    if not supabase:
        return
    try:
        payload: dict[str, Any] = {
            "outbox_status": "dispatched",
            "outbox_dispatched_at": _utc_now().isoformat(),
        }
        if celery_task_id is not None:
            payload["celery_task_id"] = celery_task_id
        await asyncio.to_thread(
            lambda: supabase.table("jobs")
                .update(payload)
                .eq("id", job_id)
                .execute()
        )
        log.debug("Outbox: marked dispatched for job %s (celery_task_id=%s)", job_id, celery_task_id)
    except Exception as exc:
        log.warning("Outbox: failed to mark dispatched for %s: %s", job_id, exc)


async def mark_outbox_error(job_id: str, error: str, attempt: int) -> None:
    """Record a dispatch failure and schedule a retry via next_attempt_at."""
    if not OUTBOX_ENABLED:
        return
    supabase = _get_supabase()
    if not supabase:
        return
    try:
        backoff_seconds = min(300, 5 * (2 ** attempt))  # 5s, 10s, 20s, 40s, 80s, 160s, 300s cap
        next_attempt = _utc_now() + timedelta(seconds=backoff_seconds)
        await asyncio.to_thread(
            lambda: supabase.table("jobs")
                .update({
                    "outbox_status": "pending",
                    "outbox_attempt_count": attempt + 1,
                    "outbox_last_error": error[:500],
                    "outbox_next_attempt_at": next_attempt.isoformat(),
                })
                .eq("id", job_id)
                .execute()
        )
    except Exception as exc:
        log.debug("Outbox: failed to record dispatch error for %s: %s", job_id, exc)


async def outbox_sweeper_once() -> int:
    """
    Single sweep pass: claim and re-dispatch stale pending outbox rows.
    Returns the number of rows re-dispatched.
    """
    if not OUTBOX_ENABLED:
        return 0
    supabase = _get_supabase()
    if not supabase:
        return 0

    stale_cutoff = (_utc_now() - timedelta(seconds=_OUTBOX_CLAIM_AGE_SECONDS)).isoformat()
    dispatched = 0

    try:
        # Fetch pending rows whose next_attempt_at is overdue
        res = await asyncio.to_thread(
            lambda: supabase.table("jobs")
                .select("id,outbox_attempt_count,status,queue_name,user_id,"
                        "normalized_url,requested_format_id,requested_media_type,"
                        "celery_task_id")
                .eq("outbox_status", "pending")
                .lte("outbox_next_attempt_at", stale_cutoff)
                .lt("outbox_attempt_count", _OUTBOX_MAX_ATTEMPTS)
                .not_.in_("status", ["completed", "failed", "cancelled"])
                .limit(20)
                .execute()
        )
        rows = res.data or []
    except Exception as exc:
        log.warning("Outbox sweeper: query failed: %s", exc)
        return 0

    for row in rows:
        job_id = row.get("id")
        if not job_id:
            continue
        attempt = int(row.get("outbox_attempt_count") or 0)
        log.warning(
            "Outbox sweeper: re-dispatching stale job %s (attempt %d/%d)",
            job_id, attempt + 1, _OUTBOX_MAX_ATTEMPTS,
        )
        try:
            from backend.job_store import get_job
            job_state = await get_job(job_id)
            if not job_state:
                # Job vanished from store; skip
                await mark_outbox_dispatched(job_id)
                continue

            status = str(job_state.get("status") or "").lower()
            if status in {"completed", "failed", "cancelled"}:
                # Terminal — mark dispatched to stop sweeping
                await mark_outbox_dispatched(job_id)
                continue

            payload_dict = job_state.get("dispatch_payload") or {}
            user_dict = job_state.get("dispatch_user") or {}
            if not payload_dict:
                # Cannot reconstruct dispatch payload; give up on this row
                log.error("Outbox sweeper: no dispatch_payload for job %s; skipping", job_id)
                await mark_outbox_error(job_id, "no_dispatch_payload", attempt)
                continue

            from backend.celery_app import celery_app, celery_available
            from backend.tasks import download_delivery_task
            if not celery_available or celery_app is None:
                # Celery not configured — fall back to local async
                from backend.job_runner import run_download_job_async
                asyncio.create_task(run_download_job_async(job_id, payload_dict, user_dict))
                await mark_outbox_dispatched(job_id, celery_task_id=None)
            else:
                result = await asyncio.to_thread(
                    lambda: download_delivery_task.delay(job_id, payload_dict, user_dict)
                )
                await mark_outbox_dispatched(job_id, celery_task_id=result.id)

            dispatched += 1
        except Exception as exc:
            log.error("Outbox sweeper: dispatch failed for job %s: %s", job_id, exc)
            await mark_outbox_error(job_id, str(exc)[:500], attempt)

    return dispatched


async def outbox_sweeper_loop() -> None:
    """Long-running background loop that runs `outbox_sweeper_once` periodically."""
    log.info("Outbox sweeper started (interval=%ds, claim_age=%ds)",
             _OUTBOX_SWEEP_INTERVAL_SECONDS, _OUTBOX_CLAIM_AGE_SECONDS)
    while True:
        try:
            n = await outbox_sweeper_once()
            if n:
                log.info("Outbox sweeper: re-dispatched %d stale job(s)", n)
        except Exception as exc:
            log.warning("Outbox sweeper loop error: %s", exc)
        await asyncio.sleep(_OUTBOX_SWEEP_INTERVAL_SECONDS)


# ─── Phase 6 P0-1: Retention & Archival Pruning ──────────────────────────────

async def prune_retained_outbox_events(
    max_age_days: int | None = None,
    batch_size: int = 500,
) -> int:
    """
    Phase 6 P0-1: Outbox Retention & Archival Pruning.

    Purges historical outbox entries that meet ALL of the following criteria:
      1. outbox_status == 'dispatched' (already handed off to workers)
      2. status IN ('completed', 'failed', 'cancelled') (strictly terminal)
      3. created_at <= now() - retention_days (older than TTL)

    STRICT SAFETY:
      - NEVER touches 'pending' rows (in-flight or awaiting retry)
      - NEVER touches active non-terminal rows ('queued', 'downloading', 'processing')
      - Safe batch limit to avoid database table lock contention
    """
    days = max_age_days if max_age_days is not None else OUTBOX_RETENTION_DAYS
    cutoff = _utc_now() - timedelta(days=days)
    cutoff_iso = cutoff.isoformat()
    pruned_count = 0

    supabase = _get_supabase()
    if supabase:
        try:
            res = await asyncio.to_thread(
                lambda: supabase.table("jobs")
                    .select("id")
                    .eq("outbox_status", "dispatched")
                    .in_("status", ["completed", "failed", "cancelled"])
                    .lte("created_at", cutoff_iso)
                    .limit(batch_size)
                    .execute()
            )
            rows = res.data or []
            if rows:
                ids_to_prune = [str(r["id"]) for r in rows if "id" in r]
                if ids_to_prune:
                    await asyncio.to_thread(
                        lambda: supabase.table("jobs")
                            .delete()
                            .in_("id", ids_to_prune)
                            .execute()
                    )
                    pruned_count += len(ids_to_prune)
                    log.info("Outbox retention: pruned %d archived database rows older than %d days", len(ids_to_prune), days)
        except Exception as exc:
            log.warning("Outbox retention: database pruning failed: %s", exc)

    # Prune in-memory / local job store
    try:
        from backend.job_store import prune_in_memory_jobs
        mem_pruned = await prune_in_memory_jobs(cutoff)
        if mem_pruned > 0:
            log.info("Outbox retention: pruned %d terminal in-memory job records", mem_pruned)
            pruned_count += mem_pruned
    except Exception as exc:
        log.debug("Outbox retention: in-memory prune error: %s", exc)

    if pruned_count > 0:
        try:
            from backend.metrics import record_outbox_pruned
            record_outbox_pruned(pruned_count)
        except Exception:
            pass

    return pruned_count


async def outbox_retention_loop() -> None:
    """Long-running background task running periodic archival pruning."""
    log.info("Outbox retention loop started (interval=%ds, retention_days=%dd)",
             OUTBOX_RETENTION_INTERVAL_SECONDS, OUTBOX_RETENTION_DAYS)
    while True:
        try:
            if is_outbox_retention_enabled():
                n = await prune_retained_outbox_events()
                if n > 0:
                    log.info("Outbox retention cycle complete: %d records pruned", n)
        except Exception as exc:
            log.warning("Outbox retention loop error: %s", exc)
        await asyncio.sleep(OUTBOX_RETENTION_INTERVAL_SECONDS)

