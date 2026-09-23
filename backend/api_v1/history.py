import logging

from fastapi import APIRouter, Depends, HTTPException

from backend.entitlements import build_effective_entitlement
from backend.auth import get_current_user, supabase

log = logging.getLogger("nexus.history")

router = APIRouter(prefix="/api/v1/history", tags=["History"])


def _history_enabled(user: dict) -> bool:
    entitlement = user.get("entitlement") or build_effective_entitlement(user)
    return bool(entitlement.get("history_enabled"))


def _normalize_history_row(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "title": row.get("title"),
        "url": row.get("url"),
        "thumbnail": row.get("thumbnail"),
        "platform": row.get("platform"),
        "format": row.get("format"),
        "format_type": row.get("format_type"),
        "filesize": row.get("filesize"),
        "duration": row.get("duration"),
        "job_id": row.get("job_id"),
        "filename": row.get("filename"),
        "direct_url": row.get("direct_url"),
        "fallback_url": row.get("fallback_url"),
        "delivery_mode": row.get("delivery_mode"),
        "expires_at": row.get("expires_at"),
        "created_at": row.get("created_at"),
    }

@router.get("/")
async def list_history(user: dict = Depends(get_current_user)):
    """
    Returns the user's persistent media history.
    Enforces RLS at the database level.
    """
    if user.get("anonymous") or not _history_enabled(user):
        return []
        
    try:
        res = supabase.table("media_history").select("*").eq("user_id", user["id"]).order("created_at", desc=True).limit(50).execute()
        return [_normalize_history_row(row) for row in (res.data or [])]
    except Exception as e:
        log.error(f"History fetch failed: {e}")
        return []

@router.post("/")
async def add_history(item: dict, user: dict = Depends(get_current_user)):
    """
    Adds a new record to the Sovereign Persistence Vault.
    Strictly for PRO users.
    """
    if user.get("anonymous") or not _history_enabled(user):
        return {"status": "skipped", "reason": "Vault access restricted to PRO users."}

    rich_payload = {
        "user_id": user["id"],
        "title": item.get("title"),
        "url": item.get("url"),
        "thumbnail": item.get("thumbnail"),
        "platform": item.get("platform"),
        "format": item.get("format"),
        "format_type": item.get("format_type"),
        "filesize": item.get("filesize"),
        "duration": item.get("duration"),
        "job_id": item.get("job_id"),
        "filename": item.get("filename"),
        "direct_url": item.get("direct_url"),
        "fallback_url": item.get("fallback_url"),
        "delivery_mode": item.get("delivery_mode"),
        "expires_at": item.get("expires_at"),
    }
    fallback_payload = {
        "user_id": user["id"],
        "title": item.get("title"),
        "url": item.get("url"),
        "thumbnail": item.get("thumbnail"),
        "platform": item.get("platform"),
        "filesize": item.get("filesize"),
        "duration": item.get("duration"),
    }

    try:
        try:
            res = supabase.table("media_history").insert(rich_payload).execute()
        except Exception as rich_exc:
            log.warning("Rich vault sync fallback activated: %s", rich_exc)
            res = supabase.table("media_history").insert(fallback_payload).execute()
        
        return {"status": "success", "id": res.data[0]["id"] if res.data else None}
    except Exception as e:
        log.error(f"Vault sync failed: {e}")
        raise HTTPException(status_code=500, detail="Persistence vault error.")

@router.delete("/{item_id}")
async def delete_history(item_id: str, user: dict = Depends(get_current_user)):
    """Deletes a specific entry from the vault."""
    if user.get("anonymous"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    supabase.table("media_history").delete().eq("id", item_id).eq("user_id", user["id"]).execute()
    return {"status": "deleted"}
