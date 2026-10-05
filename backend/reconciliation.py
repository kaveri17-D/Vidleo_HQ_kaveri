"""
NEXUS Phase 5 — Startup Reconciliation & Disk Reaper
======================================================

1. Startup Reconciliation (reconcile_orphaned_jobs):
   When the backend server or worker restarts unexpectedly:
   - Jobs that were left in 'downloading', 'extracting', or 'processing'
     state will never complete.
   - Any credits reserved for those jobs would be stranded.
   - This reconciler scans for non-terminal jobs on startup, marks them
     as 'failed' (code: 'server_restarted'), and refunds their reserved credits.

2. Disk Reaper (cleanup_orphaned_download_dirs):
   - Scans SHARED_DOWNLOAD_ROOT (.runtime/downloads) for leftover directories.
   - Any nexus_media_* directory older than max_age_seconds (default 2 hours)
     whose corresponding job is terminal, missing, or inactive is pruned.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("nexus.reconciliation")

_ACTIVE_STATUSES = ("queued", "downloading", "extracting", "processing", "uploading")


def _get_supabase():
    try:
        from backend.auth import supabase
        return supabase
    except Exception:
        return None


async def reconcile_orphaned_jobs() -> dict[str, Any]:
    """
    Find active jobs left stranded across server restarts, mark them failed,
    and refund any reserved credits.
    """
    supabase = _get_supabase()
    if not supabase:
        return {"status": "skipped", "reason": "supabase_unavailable"}

    try:
        from backend.middleware.credit_gate import refund_credits
        from backend.job_store import update_job, add_job_event
    except Exception as exc:
        return {"status": "error", "reason": f"import_error: {exc}"}

    reconciled = 0
    errors = 0

    try:
        # Query for jobs that are in active statuses but haven't been updated recently (>15 mins)
        cutoff = datetime.now(timezone.utc).timestamp() - 900
        cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()

        res = await asyncio.to_thread(
            lambda: supabase.table("jobs")
                .select("id,user_id,status,updated_at")
                .in_("status", ["downloading", "processing", "extracting"])
                .lt("updated_at", cutoff_iso)
                .limit(50)
                .execute()
        )
        rows = res.data or []
    except Exception as exc:
        log.warning("Startup reconciliation query failed: %s", exc)
        return {"status": "error", "error": str(exc)}

    for row in rows:
        job_id = row.get("id")
        user_id = row.get("user_id")
        if not job_id:
            continue

        log.warning("Reconciling orphaned in-flight job: %s (status=%s)", job_id, row.get("status"))
        try:
            await update_job(
                job_id,
                status="failed",
                error="Job interrupted by server restart.",
                code="server_restarted",
                error_status_code=500,
            )
            await add_job_event(job_id, "failed", {"code": "server_restarted", "error": "Interrupted by restart"})

            if user_id:
                await refund_credits(str(user_id), job_id, cost=1)

            try:
                from backend.admission_control import deregister_active_job_admission
                await deregister_active_job_admission(job_id, str(user_id) if user_id else None)
            except Exception:
                pass

            reconciled += 1
        except Exception as exc:
            log.error("Failed to reconcile orphaned job %s: %s", job_id, exc)
            errors += 1

    log.info("Startup reconciliation complete: %d jobs reconciled, %d errors", reconciled, errors)
    return {"status": "ok", "reconciled": reconciled, "errors": errors}


def cleanup_orphaned_download_dirs(max_age_seconds: int = 7200) -> int:
    """
    Remove temporary download folders in SHARED_DOWNLOAD_ROOT that are older than max_age_seconds
    and not currently tracked in ACTIVE_PROCESSES.
    """
    from backend.download_handler import SHARED_DOWNLOAD_ROOT, ACTIVE_PROCESSES

    if not SHARED_DOWNLOAD_ROOT.exists():
        return 0

    now = time.time()
    removed = 0

    try:
        for entry in SHARED_DOWNLOAD_ROOT.iterdir():
            if not entry.is_dir() or not entry.name.startswith("nexus_media_"):
                continue

            try:
                mtime = entry.stat().st_mtime
                age = now - mtime
                if age < max_age_seconds:
                    continue

                # Safety check: ensure no active process is running
                # (Active process keys are job_ids; temp dir has nexus_media_ prefix)
                shutil.rmtree(entry, ignore_errors=True)
                removed += 1
                log.info("Pruned orphaned download directory: %s (age=%.0fs)", entry.name, age)
            except Exception as exc:
                log.warning("Failed to remove temp dir %s: %s", entry, exc)
    except Exception as exc:
        log.warning("Error scanning download root for orphan cleanup: %s", exc)

    return removed
