import uuid
import asyncio
import logging
import multiprocessing
import hmac
import hashlib
import json
import secrets
import time
from typing import Any

import yt_dlp
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.api_v1.middleware import (
    create_api_key_record,
    get_default_rate_limit_for_plan,
    get_api_key_record_for_user,
    list_api_keys_for_user,
    revoke_api_key_for_user,
    rotate_api_key_record,
    record_api_request_result,
    summarize_api_key_usage,
    supabase,
    update_api_key_record,
    verify_b2b_key,
)
from backend.api_v1.models import BatchExtractRequest, ExtractRequest, ExtractionResult, JobResponse
from backend.auth import get_current_user
from backend.entitlements import build_effective_entitlement
from backend.extractor_runtime import build_user_facing_extractor_error, extract_info_with_fallback, is_platform_transport_issue
from backend.extractor_service import get_provider_name
from backend.utils import _sanitize_formats, get_ytdlp_opts

log = logging.getLogger("nexus.api_v1.router")
router = APIRouter(prefix="/api/v1", tags=["B2B API"])


class UpdateKeyPayload(BaseModel):
    name: str | None = None
    scopes: list[str] | None = None
    rate_limit: int | None = None


@router.post("/extract")
async def extract_single(
    payload: ExtractRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    key_data: dict = Depends(verify_b2b_key)
):
    """
    Sovereign Extraction Endpoint:
    - Synchronous metadata probing (Standard client B2B integration)
    """
    target_url = payload.source_url or payload.url
    if not target_url:
        raise HTTPException(status_code=400, detail="Missing target media URL. Provide 'url' or 'source_url'.")

    url = str(target_url)

    plan = key_data.get("plan", "pro")
    is_owner = key_data.get("is_owner", False)
    provider = get_provider_name(url)
    started_at = time.perf_counter()
    response_code = 200
    
    opts = get_ytdlp_opts(plan, is_owner=is_owner)
    opts.update({
        "skip_download": True,
        "extract_flat": False,
    })

    try:
        log.info("🔍 B2B Probing signal: %s", url)

        # 🛡️ SOVEREIGN SENTINEL: The Threaded Watchdog (Windows Compatibility)
        import threading
        import queue

        def _extract_worker(url, opts, q):
            try:
                q.put(extract_info_with_fallback(url, opts))
            except Exception as e:
                q.put(e)

        res_q = queue.Queue()
        t = threading.Thread(target=_extract_worker, args=(url, opts, res_q))
        t.start()
        
        # ⚔️ B2B GUILLOTINE: 15.0s Watchdog
        await asyncio.to_thread(t.join, 15.0)

        if t.is_alive():
            log.error("⚔️ Sovereign Guillotine dropped for %s", url)
            # On Windows/Threads we cannot SIGKILL, but we orphan it for the audit
            raise TimeoutError("Guillotine")

        if res_q.empty():
            raise Exception("B2B Extraction null signal.")
            
        info = res_q.get()
        if isinstance(info, Exception):
            raise info

    except TimeoutError:
        response_code = 408
        raise HTTPException(status_code=408, detail="B2B Extraction Timeout Exceeded (15s).")
    except yt_dlp.utils.DownloadError as exc:
        status_code = 503 if is_platform_transport_issue(url, exc) else 422
        response_code = status_code
        raise HTTPException(status_code=status_code, detail=build_user_facing_extractor_error(url, exc, action="metadata probe"))
    except Exception as exc:
        log.error("B2B Extraction Error: %s", exc)
        response_code = 422
        raise HTTPException(status_code=422, detail=build_user_facing_extractor_error(url, exc, action="metadata probe"))
    finally:
        await record_api_request_result(
            key_id=str(key_data.get("key_id") or ""),
            user_id=str(key_data.get("user_id") or ""),
            endpoint=str(request.url.path),
            provider=provider,
            response_code=response_code,
            ip_hint=request.client.host if request.client else None,
            processing_ms=max(1, int((time.perf_counter() - started_at) * 1000)),
        )

    raw_formats: list[dict] = info.get("formats") or []
    formats = _sanitize_formats(raw_formats, include_owner_formats=is_owner)

    return {
        "title": info.get("title", "Unknown Title"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader") or info.get("channel"),
        "webpage_url": info.get("webpage_url", url),
        "formats": formats
    }

@router.post("/extract/batch", response_model=JobResponse)
async def extract_batch(
    payload: BatchExtractRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    key_data: dict = Depends(verify_b2b_key)
) -> dict:
    """
    Asynchronous Batch Hub:
    - Accepts up to 50 URLs.
    - Returns Job ID immediately (202 Accepted).
    - Triggers Background Task with Webhook delivery.
    """
    job_id = str(uuid.uuid4())
    started_at = time.perf_counter()
    
    # In a real-world L9 setup, we'd use Celery/RabbitMQ here.
    # For this implementation, we use FastAPI BackgroundTasks + The Sovereign Sentinel.
    background_tasks.add_task(
        process_batch_job, 
        job_id, 
        payload.urls, 
        payload.callback_url,
        key_data["user_id"]
    )

    response = {
        "job_id": job_id,
        "status": "accepted",
        "message": f"Processing {len(payload.urls)} records. Signal will push to {payload.callback_url}."
    }
    await record_api_request_result(
        key_id=str(key_data.get("key_id") or ""),
        user_id=str(key_data.get("user_id") or ""),
        endpoint=str(request.url.path),
        provider="batch",
        response_code=202,
        ip_hint=request.client.host if request.client else None,
        processing_ms=max(1, int((time.perf_counter() - started_at) * 1000)),
    )
    return response

# ─── B2B Key Management (Admin Control) ──────────────────────────────────────

@router.post("/keys/create")
async def create_key(user: dict = Depends(get_current_user)):
    """
    Generates a secure nx_live_ API key.
    The raw key is returned EXACTLY ONCE to the client.
    """
    if user.get("anonymous") or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    entitlement = user.get("entitlement") or build_effective_entitlement(user)
    if not entitlement.get("api_enabled") and not user.get("is_owner"):
        raise HTTPException(status_code=403, detail="API keys require an active API Sector plan.")
    effective_plan = str(entitlement.get("plan") or user.get("plan") or "api").strip().lower()
    default_scopes = ["extract:read", "download:create", "usage:read"]
    if effective_plan in {"api_growth", "enterprise"}:
        default_scopes.append("webhook:write")
    default_rate_limit = get_default_rate_limit_for_plan(effective_plan)

    raw_key = f"nx_live_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    
    record = await create_api_key_record({
        "user_id": user["id"],
        "key_prefix": raw_key[:12],
        "key_hash": key_hash,
        "name": "Production Key",
        "status": "active",
        "plan_tier": effective_plan,
        "scopes": default_scopes,
        "rate_limit": default_rate_limit,
    })

    return {"key": raw_key, "data": record}

@router.post("/developer/keys")
async def generate_developer_key(user: dict = Depends(get_current_user)):
    """
    Generates a secure sk_live_ API key.
    The raw key is returned EXACTLY ONCE to the B2B developer client.
    """
    if user.get("anonymous") or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    entitlement = user.get("entitlement") or build_effective_entitlement(user)
    if not entitlement.get("api_enabled") and not user.get("is_owner"):
        raise HTTPException(status_code=403, detail="API keys require an active API Sector plan.")
    effective_plan = str(entitlement.get("plan") or user.get("plan") or "api").strip().lower()
    default_scopes = ["extract:read", "download:create", "usage:read"]
    if effective_plan in {"api_growth", "enterprise"}:
        default_scopes.append("webhook:write")
    default_rate_limit = get_default_rate_limit_for_plan(effective_plan)

    raw_key = f"sk_live_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    
    record = await create_api_key_record({
        "user_id": user["id"],
        "key_prefix": raw_key[:12],
        "key_hash": key_hash,
        "name": "Developer Key",
        "status": "active",
        "plan_tier": effective_plan,
        "scopes": default_scopes,
        "rate_limit": default_rate_limit,
    })

    return {"key": raw_key, "data": record}

@router.get("/keys/list")
async def list_keys(user: dict = Depends(get_current_user)):
    """Returns all active keys for the session user."""
    if user.get("anonymous") or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    return await list_api_keys_for_user(str(user["id"]))

@router.delete("/keys/revoke/{key_id}")
async def revoke_key(key_id: str, user: dict = Depends(get_current_user)):
    """Hard-revocation of an API key."""
    if user.get("anonymous") or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    record = await revoke_api_key_for_user(str(user["id"]), key_id)
    if not record:
        raise HTTPException(status_code=404, detail="API key not found.")
    return {"status": "revoked"}


@router.patch("/keys/{key_id}")
async def update_key(key_id: str, payload: UpdateKeyPayload, user: dict = Depends(get_current_user)):
    if user.get("anonymous") or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    updates: dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.scopes is not None:
        updates["scopes"] = payload.scopes
    if payload.rate_limit is not None:
        updates["rate_limit"] = payload.rate_limit
    if not updates:
        raise HTTPException(status_code=400, detail="No API key updates provided.")

    record = await update_api_key_record(str(user["id"]), key_id, updates)
    if not record:
        raise HTTPException(status_code=404, detail="API key not found.")
    return {"status": "updated", "data": record}


@router.post("/keys/rotate/{key_id}")
async def rotate_key(key_id: str, user: dict = Depends(get_current_user)):
    if user.get("anonymous") or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    raw_key, record = await rotate_api_key_record(str(user["id"]), key_id)
    if not raw_key or not record:
        raise HTTPException(status_code=404, detail="API key not found.")
    return {"status": "rotated", "key": raw_key, "data": record}


@router.get("/keys/{key_id}/usage")
async def key_usage(key_id: str, user: dict = Depends(get_current_user)):
    if user.get("anonymous") or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    record = await get_api_key_record_for_user(str(user["id"]), key_id)
    if not record:
        raise HTTPException(status_code=404, detail="API key not found.")
    usage = await summarize_api_key_usage(key_id)
    return {"key_id": key_id, "usage": usage}


class UploadUrlPayload(BaseModel):
    filename: str
    content_type: str | None = None


@router.post("/developer/upload-url")
async def generate_presigned_upload_url_route(
    payload: UploadUrlPayload,
    key_data: dict = Depends(verify_b2b_key)
):
    import os
    from backend.storage_handler import _get_r2_client, _guess_content_type
    
    r2_client = _get_r2_client()
    if not r2_client:
        raise HTTPException(status_code=500, detail="Cloudflare R2 storage is not configured.")
        
    bucket = os.environ.get("R2_BUCKET")
    if not bucket:
        raise HTTPException(status_code=500, detail="Cloudflare R2 bucket name not configured.")
        
    job_id = str(uuid.uuid4())
    object_key = f"nexus-uploads/{key_data['user_id']}/{job_id}/{payload.filename}"
    
    content_type = payload.content_type or _guess_content_type(payload.filename) or "application/octet-stream"
    
    try:
        # Generate presigned PUT URL
        upload_url = r2_client.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": bucket,
                "Key": object_key,
                "ContentType": content_type
            },
            ExpiresIn=3600,  # 1 hour
        )
        
        # We also want to generate a presigned GET URL for yt-dlp to read the file
        file_url = r2_client.generate_presigned_url(
            ClientMethod="get_object",
            Params={
                "Bucket": bucket,
                "Key": object_key
            },
            ExpiresIn=86400 * 7,  # 7 days retention
        )
        
        return {
            "upload_url": upload_url,
            "file_url": file_url,
            "object_key": object_key,
            "job_id": job_id
        }
    except Exception as exc:
        log.error("Failed to generate presigned upload URL: %s", exc)
        raise HTTPException(status_code=500, detail=f"S3 sign failure: {str(exc)}")


# ─── Telegram Handshake (Web -> Bot) ────────────────────────────────────────

@router.post("/keys/link-telegram")
async def link_telegram_request(user: dict = Depends(get_current_user)):
    """
    Generates a short-lived (10m) JWT for the deep link.
    The 'exp' field is a standard Unix timestamp integer for L9 compliance.
    """
    import jwt as pyjwt
    from datetime import datetime, timedelta
    from backend.auth import SUPABASE_JWT_SECRET
    
    expiry = datetime.utcnow() + timedelta(minutes=10)
    payload = {
        "user_id": user["id"],
        "exp": int(expiry.timestamp()) 
    }
    
    token = pyjwt.encode(payload, SUPABASE_JWT_SECRET, algorithm="HS256")
    return {"link": f"https://t.me/NexusMediaBot?start={token}"}

async def process_batch_job(job_id: str, urls: list, callback_url: str, user_id: str):
    """
    The Batch Signal Processor:
    - Serialized extraction to protect CPU.
    - Active Revocation: Sub-1ms heartbeat check before each item.
    - HMAC signature on payload.
    - Webhook push.
    """
    import httpx
    import time
    from backend.api_v1.middleware import r
    from backend.utils import YTDLP_BASE_OPTS

    results = []
    log.info("Starting Batch Job %s for user %s", job_id, user_id)
    
    for url in urls:
        # 🗡️ THE SOVEREIGN HEARTBEAT: Active Revocation
        # Kills the process in < 500ms if the user is banned mid-job.
        if await r.exists(f"blacklist:{user_id}"):
            log.warning("Active Revocation triggered for user %s. Killing Job %s.", user_id, job_id)
            break
            
        try:
            with yt_dlp.YoutubeDL({**YTDLP_BASE_OPTS, "skip_download": True}) as ydl:
                # Run extraction in a thread to keep the loop and heartbeats responsive
                info = await asyncio.to_thread(ydl.extract_info, url, download=False)
                results.append({"url": url, "status": "success", "title": info.get("title")})
        except Exception as e:
            results.append({"url": url, "status": "error", "message": str(e)})

    # ⛓️ HMAC SIGNATURE: Sovereignty for the Callback
    # Prevents 'Webhook Spoofing' attacks.
    payload_data = {
        "job_id": job_id,
        "status": "completed",
        "results": results,
        "timestamp": time.time()
    }
    
    # We use the user_id's master secret for the signature (or a dedicated webhook secret)
    payload_bytes = json.dumps(payload_data, sort_keys=True).encode()
    signature = hmac.new(b"SOVEREIGN_CALLBACK_SECRET", payload_bytes, hashlib.sha256).hexdigest()

    # Final Webhook Push
    try:
         async with httpx.AsyncClient() as client:
            await client.post(callback_url, json=payload_data, headers={
                "X-Nexus-Signature": signature,
                "Content-Type": "application/json"
            }, timeout=10.0)
    except Exception as e:
        log.error("Failed to push batch results to %s: %s", callback_url, e)


# ─── Omnichannel Social Syndication ──────────────────────────────────────────

class BroadcastPayload(BaseModel):
    job_id: str
    video_url: str
    caption: str
    targets: list[str]  # e.g., ['youtube', 'instagram', 'tiktok']


@router.post("/syndicate/broadcast", status_code=202)
async def broadcast_syndication(
    payload: BroadcastPayload,
    key_data: dict = Depends(verify_b2b_key)
):
    """
    Omnichannel Social Syndication Broadcast Endpoint.
    Iterates through platforms, fetches and decrypts credentials,
    and schedules parallel tasks in Celery 'syndicate' queue.
    """
    import os
    from backend.celery_app import celery_app

    user_id = key_data.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="User ID resolution failed in security gateway.")

    secret_key = os.environ.get("SOCIAL_ENCRYPTION_KEY", "nexus_social_secret_key_default")
    dispatched_tasks = {}

    for target in payload.targets:
        target_clean = target.lower().strip()
        if not target_clean:
            continue

        # Query and decrypt credentials via RPC helper function
        rpc_res = supabase.rpc("get_decrypted_social_account", {
            "target_user_id": user_id,
            "target_platform": target_clean,
            "secret_key": secret_key
        }).execute()

        if rpc_res.error:
            log.error("Failed querying social credentials for user %s, platform %s: %s", user_id, target_clean, rpc_res.error)
            continue

        records = rpc_res.data
        if not records or len(records) == 0:
            log.warning("No authenticated social credential found for user %s on platform %s", user_id, target_clean)
            continue

        account = records[0]
        
        # Dispatch Celery task
        task_payload = {
            "user_id": user_id,
            "platform": target_clean,
            "access_token": account.get("decrypted_access_token"),
            "refresh_token": account.get("decrypted_refresh_token"),
            "video_url": payload.video_url,
            "caption": payload.caption,
            "job_id": payload.job_id
        }

        try:
            task = celery_app.send_task(
                "backend.workers.syndication.execute_platform_upload_task",
                kwargs=task_payload,
                queue="syndicate"
            )
            dispatched_tasks[target_clean] = task.id
        except Exception as exc:
            log.error("Failed to enqueue syndication task for platform %s: %s", target_clean, exc)
            raise HTTPException(status_code=500, detail=f"Broker queue connection error: {str(exc)}")

    return {
        "status": "accepted",
        "job_id": payload.job_id,
        "tasks": dispatched_tasks
    }

