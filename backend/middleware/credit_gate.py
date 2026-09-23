import json
import logging
import os
import secrets
import time
from typing import Any, Optional

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from starlette.middleware.base import BaseHTTPMiddleware

from backend.auth import get_current_user
from backend.api_v1.middleware import _get_redis_client, verify_b2b_key
from backend.supabase_client import Client, create_client

log = logging.getLogger("nexus.middleware.credit_gate")

# Initialize direct Supabase client for DB sync operations
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client | None = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY) if SUPABASE_URL and SUPABASE_SERVICE_KEY else None

# Lua Script for Credit Ledger
LUA_LEDGER_FUNCTION = """#!lua name=nexus_ledger

local function check_and_reserve(keys, args)
    local tenant_id = keys[1]
    local job_id = args[1]
    local cost = tonumber(args[2])
    local operation = args[3]
    local max_ops = tonumber(args[4] or "100")
    
    local balance_key = "tenant:" .. tenant_id .. ":credits"
    local reserved_key = "tenant:" .. tenant_id .. ":reserved"
    local rate_key = "tenant:" .. tenant_id .. ":rate:" .. operation
    
    -- 1. Sliding Window Rate Limiting check
    local now = redis.call("TIME")
    local now_ms = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
    local window_start = now_ms - 60000
    
    redis.call("ZREMRANGEBYSCORE", rate_key, "-inf", window_start)
    local current_rate = redis.call("ZCARD", rate_key)
    
    if current_rate >= max_ops then
        return {-2, current_rate, max_ops} -- Blocked by active rate limit
    end
    
    redis.call("ZADD", rate_key, now_ms, job_id)
    redis.call("EXPIRE", rate_key, 60)
    
    -- 2. Balance Sufficiency validation
    local available = tonumber(redis.call("HGET", balance_key, "available") or "0")
    if available < cost then
        return {-1, available, cost} -- Blocked by insufficient funds
    end
    
    -- 3. Atomic Double-Entry asset reservation shift
    redis.call("HINCRBY", balance_key, "available", -cost)
    redis.call("HSET", reserved_key, job_id, cost)
    
    return {1, available - cost, cost} -- Success
end

redis.register_function("check_and_reserve", check_and_reserve)
"""

async def load_redis_ledger_functions() -> None:
    """Auto-registers the Lua function on application startup."""
    redis_client = _get_redis_client()
    if redis_client is None:
        log.warning("Redis client unavailable; skipping Lua function loading")
        return
    try:
        # Load Lua script containing the function
        # Using REPLACE to overwrite if the function already exists
        await redis_client.execute_command("FUNCTION", "LOAD", "REPLACE", LUA_LEDGER_FUNCTION)
        log.info("Successfully loaded/updated Upstash Redis Lua functions for Credit Ledger")
    except Exception as exc:
        log.error("Failed to load Redis Lua functions: %s", exc)

async def populate_hot_balance_if_needed(user_id: str) -> None:
    """Read-through cache to sync Supabase balance to Redis on demand."""
    redis_client = _get_redis_client()
    if redis_client is None or not supabase:
        return

    balance_key = f"tenant:{user_id}:credits"
    try:
        exists = await redis_client.hexists(balance_key, "available")
        if not exists:
            # Query cold store (Supabase)
            res = supabase.table("profiles").select("clip_credits").eq("id", user_id).maybe_single().execute()
            clip_credits = 0
            if res.data:
                clip_credits = int(res.data.get("clip_credits") or 0)
            else:
                log.warning("No profile found for user %s on Supabase during read-through", user_id)
                # If profile doesn't exist, bootstrap it with 10 credits (default)
                try:
                    # Fetch user email if possible from token payload context (not available here, so generic/none)
                    supabase.table("profiles").insert({"id": user_id, "clip_credits": 10}).execute()
                    clip_credits = 10
                except Exception:
                    pass

            await redis_client.hset(balance_key, "available", clip_credits)
            await redis_client.expire(balance_key, 86400)  # 24 hour TTL
            log.info("Synced user %s cold balance (%d credits) to hot Redis cache", user_id, clip_credits)
    except Exception as exc:
        log.error("Error populating hot credit balance for %s: %s", user_id, exc)

async def reserve_credits(user_id: str, job_id: str, cost: int, operation: str, max_ops: int = 100) -> tuple[int, int, int]:
    """Calls the Lua function check_and_reserve in Redis."""
    redis_client = _get_redis_client()
    if redis_client is None:
        log.warning("Redis client unavailable; defaulting to allow (degraded mode)")
        return 1, 0, cost

    await populate_hot_balance_if_needed(user_id)

    try:
        # call the FCALL function
        res = await redis_client.execute_command(
            "FCALL", "check_and_reserve", 1, user_id, job_id, cost, operation, str(max_ops)
        )
        # Lua returns [status, val1, val2]
        return int(res[0]), int(res[1]), int(res[2])
    except Exception as exc:
        log.error("Redis reservation failed for user %s: %s. Degrading gracefully.", user_id, exc)
        return 1, 0, cost

async def commit_credits(user_id: str, job_id: str, cost: int) -> None:
    """Removes reservation and commits deduction permanently to Supabase."""
    redis_client = _get_redis_client()
    if redis_client is None:
        return

    reserved_key = f"tenant:{user_id}:reserved"
    try:
        # Check if reservation exists
        reserved = await redis_client.hget(reserved_key, job_id)
        if not reserved:
            return

        # No cold store configured: the hot-tier deduction already happened at
        # reserve time, so just release the reservation bucket.
        if not supabase:
            await redis_client.hdel(reserved_key, job_id)
            return

        # Persist the deduction to the cold store FIRST, and only release the
        # Redis reservation once Supabase has durably recorded it. If we deleted
        # the reservation first and the Supabase write then failed, the charge
        # would be silently lost: the next read-through would resync the stale
        # (higher) cold balance back into the hot cache, effectively refunding
        # the user. Retaining the reservation on failure lets
        # billing_reconciliation_task retry the commit instead.
        res = supabase.table("profiles").select("clip_credits,total_credits_consumed").eq("id", user_id).maybe_single().execute()
        if not res.data:
            log.warning("No profile for user %s during commit; retaining reservation %s for reconciliation", user_id, job_id)
            return

        curr_credits = int(res.data.get("clip_credits") or 0)
        curr_consumed = int(res.data.get("total_credits_consumed") or 0)

        supabase.table("profiles").update({
            "clip_credits": max(0, curr_credits - cost),
            "total_credits_consumed": curr_consumed + cost,
        }).eq("id", user_id).execute()

        # Cold store acknowledged — now it is safe to clear the reservation.
        await redis_client.hdel(reserved_key, job_id)
        log.info("Committed %d credits deduction for user %s in Supabase", cost, user_id)
    except Exception as exc:
        log.error(
            "Failed to commit credits for user %s, job %s: %s (reservation retained for reconciliation)",
            user_id, job_id, exc,
        )

async def refund_credits(user_id: str, job_id: str, cost: int) -> None:
    """Returns reserved credits back to the available hot balance in Redis."""
    redis_client = _get_redis_client()
    if redis_client is None:
        return

    reserved_key = f"tenant:{user_id}:reserved"
    balance_key = f"tenant:{user_id}:credits"
    try:
        # Check if reservation exists
        reserved = await redis_client.hget(reserved_key, job_id)
        if reserved:
            # Remove reservation
            await redis_client.hdel(reserved_key, job_id)
            # Refund available balance in Redis
            await redis_client.hincrby(balance_key, "available", cost)
            log.info("Refunded %d credits to user %s (job %s failed/cancelled)", cost, user_id, job_id)
    except Exception as exc:
        log.error("Failed to refund credits for user %s, job %s: %s", user_id, job_id, exc)


class CreditGateMiddleware(BaseHTTPMiddleware):
    """
    FastAPI Interceptor Middleware:
    Interceptors requests to download and extract endpoints, and enforces credit validation.
    """
    async def dispatch(self, request: Request, call_next: Any) -> Response:
        path = request.url.path.rstrip("/")
        # Filter for targets
        targets = {
            "/extract",
            "/api/extract",
            "/api/v1/extract",
            "/api/v1/extract/batch",
            "/api/info",
            "/download",
            "/api/download",
            "/api/download-job"
        }
        
        if path not in targets:
            return await call_next(request)

        # 1. Authenticate Request
        user = await self._authenticate(request)
        if not user:
            return JSONResponse(status_code=401, content={"detail": "Authentication required"})

        # Bypass billing/credits for admins and owners
        if user.get("limit_bypass") or user.get("is_owner"):
            return await call_next(request)

        user_id = user.get("id")
        if not user_id:
            # Anonymous users are allowed but are checked in normal daily limit rate limiter
            return await call_next(request)

        # 2. Determine Cost & Operation name
        cost = 1
        operation = "extract" if "extract" in path or "info" in path else "download"
        
        # Allocate job_id / trace_id
        job_id = secrets.token_urlsafe(16)
        # Inject the job_id into request state so downstream route handler can reuse it
        request.state.job_id = job_id
        
        # 3. Call Lua check and reserve function in Redis
        status, val1, val2 = await reserve_credits(user_id, job_id, cost, operation, max_ops=100)
        
        if status == -2:
            # Rate limit hit
            return JSONResponse(
                status_code=429,
                content={"detail": f"Rate limit exceeded. Current: {val1}/{val2} operations per minute."}
            )
        elif status == -1:
            # Insufficient credits
            from backend.auth import get_tiered_limit_reached_message
            return JSONResponse(
                status_code=402,
                content={"detail": get_tiered_limit_reached_message(user)}
            )
        
        # Determine if this request queues an async background job
        is_async_job = (request.method == "POST" and path in {
            "/download",
            "/api/download",
            "/api/download-job"
        })

        # Proceed with request
        try:
            response = await call_next(request)
            if response.status_code >= 400:
                await refund_credits(user_id, job_id, cost)
            else:
                # If it's a sync request, commit credits immediately
                if not is_async_job:
                    await commit_credits(user_id, job_id, cost)
            return response
        except Exception as exc:
            # On handler exception, refund the credit
            await refund_credits(user_id, job_id, cost)
            raise exc

    async def _authenticate(self, request: Request) -> Optional[dict]:
        auth_header = request.headers.get("Authorization")
        credentials = None
        is_b2b = False
        
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]
            credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
            if token.startswith("nx_live_") or token.startswith("nx_test_"):
                is_b2b = True
        elif "sb-access-token" in request.cookies:
            token = request.cookies.get("sb-access-token")
            credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        if is_b2b:
            try:
                key_data = await verify_b2b_key(request, credentials)
                if key_data:
                    from backend.auth import resolve_user_role
                    # Load dummy profile context
                    profile_data = key_data.get("profiles") or {}
                    role = resolve_user_role(profile_data, {})
                    is_owner = role in {"owner", "admin"}
                    return {
                        "id": key_data.get("user_id"),
                        "email": profile_data.get("email") or "b2b_key",
                        "plan": key_data.get("plan", "pro"),
                        "role": role,
                        "is_owner": is_owner,
                        "limit_bypass": is_owner,
                        "anonymous": False,
                    }
            except Exception:
                pass
            return None
        else:
            try:
                user = await get_current_user(request, credentials)
                return user
            except Exception:
                return None
