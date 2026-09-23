from __future__ import annotations

import os
import time
import tempfile
import logging
from pathlib import Path
from typing import Any

from backend.supabase_client import create_client

log = logging.getLogger("nexus.cookie_vault")

BACKEND_DIR = Path(__file__).resolve().parent
RUNTIME_COOKIE_DIR = BACKEND_DIR / ".runtime" / "cookies"

# Ensure the runtime cookie directory exists
RUNTIME_COOKIE_DIR.mkdir(parents=True, exist_ok=True)

def _get_supabase():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    try:
        return create_client(url, key)
    except Exception:
        return None

def acquire_vault_cookie_file(provider: str) -> dict[str, Any]:
    """
    Acquires an active cookie session from the Supabase dynamic cookie pool.
    
    If the dynamic pool is not configured, or if the query fails, it returns 
    a fallback dict pointing to the static cookies.txt.
    
    Returns:
        dict: {
            "path": str | None,         # Absolute path to a temporary netscape cookie file
            "account_id": str | None,   # Account record ID for result tracking
            "source": "vault" | "static"
        }
    """
    provider_key = str(provider or "unknown").strip().lower()
    
    # ── Fallback Setup ──
    static_path = BACKEND_DIR / "cookies.txt"
    fallback_res = {
        "path": str(static_path) if static_path.exists() else None,
        "account_id": None,
        "source": "static"
    }
    
    supabase = _get_supabase()
    if not supabase:
        return fallback_res

    try:
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Query active, non-quarantined cookies for the requested provider.
        # supabase-py's QueryBuilder doesn't expose .or_(); the equivalent is
        # `or` as a positional filter via .filter() or composing via .execute()
        # then filtering client-side. We do the simple, correct thing: fetch
        # active rows and filter quarantine in Python.
        res = (
            supabase.table("social_cookies")
            .select("id, cookie_data, username, quarantined_until")
            .eq("provider", provider_key)
            .eq("status", "active")
            .execute()
        )

        all_rows = res.data or []
        records = [
            row for row in all_rows
            if not row.get("quarantined_until") or str(row.get("quarantined_until")) < now_iso
        ]
        if not records:
            log.warning("No active cookies found in Supabase vault for %s. Falling back to static cookies.txt.", provider_key)
            return fallback_res
            
        # Select the session with the least usage or random rotation
        import random
        selected = random.choice(records)
        cookie_id = selected["id"]
        cookie_data = selected["cookie_data"]
        
        # Write cookie data into a temporary netscape-format file in the runtime folder
        fd, temp_path = tempfile.mkstemp(prefix=f"vault_{provider_key}_{selected['username']}_", suffix=".txt", dir=RUNTIME_COOKIE_DIR)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(cookie_data)
            
        log.info("Successfully acquired dynamic cookie from vault for %s (Account: %s)", provider_key, selected['username'])
        return {
            "path": temp_path,
            "account_id": cookie_id,
            "source": "vault"
        }
        
    except Exception as exc:
        log.error("Error accessing dynamic cookie vault for %s: %s. Falling back to static cookies.txt.", provider_key, exc)
        return fallback_res

def record_cookie_result(account_id: str | None, *, success: bool, reason: str | None = None) -> None:
    """
    Tracks cookie session success/failure inside Supabase and handles self-healing quarantine.
    
    If the account encounters 3 consecutive failures, it gets quarantined automatically.
    """
    if not account_id:
        return
        
    supabase = _get_supabase()
    if not supabase:
        return
        
    try:
        if success:
            supabase.table("social_cookies").update({
                "consecutive_failures": 0,
                "status": "active",
                "quarantined_until": None,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }).eq("id", account_id).execute()
        else:
            # Increment failure counter
            res = supabase.table("social_cookies").select("consecutive_failures, provider").eq("id", account_id).maybe_single().execute()
            data = res.data or {}
            
            current_failures = int(data.get("consecutive_failures") or 0) + 1
            update_payload: dict[str, Any] = {
                "consecutive_failures": current_failures,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
            
            # Self-healing quarantine threshold: 3 consecutive failures
            if current_failures >= 3:
                # Quarantine for 1 hour (3600 seconds)
                quarantine_time = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 3600))
                update_payload["quarantined_until"] = quarantine_time
                log.warning("Account %s quarantined in vault until %s due to consecutive failures.", account_id, quarantine_time)
                
            supabase.table("social_cookies").update(update_payload).eq("id", account_id).execute()
            
    except Exception as exc:
        log.error("Failed to update cookie result for %s: %s", account_id, exc)

def cleanup_vault_cookie_file(cookie_info: dict[str, Any]) -> None:
    """
    Cleans up any temporary file created by acquire_vault_cookie_file.
    """
    if not cookie_info or cookie_info.get("source") != "vault":
        return
        
    path = cookie_info.get("path")
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass
