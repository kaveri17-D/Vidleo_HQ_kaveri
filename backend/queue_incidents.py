from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

from backend.supabase_client import Client, create_client

log = logging.getLogger("nexus.queue_incidents")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
supabase: Client | None = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY) if SUPABASE_URL and SUPABASE_SERVICE_KEY else None


async def record_queue_incident(
    *,
    provider: str = "celery",
    incident_type: str,
    queue_name: str,
    job_id: str | None = None,
    runner: str | None = None,
    detail: str | None = None,
) -> None:
    if not supabase:
        return

    payload = {
        "provider": provider,
        "incident_type": incident_type,
        "queue_name": queue_name,
        "job_id": job_id,
        "runner": runner,
        "detail": detail,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    def _write() -> None:
        try:
            supabase.table("queue_incidents").insert(payload).execute()
        except Exception as exc:
            log.debug("Skipping queue incident sync for %s/%s: %s", queue_name, incident_type, exc)

    await asyncio.to_thread(_write)
