import asyncio
import hashlib
import json
import logging
import os
import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import redis.asyncio as redis

from backend.entitlements import build_effective_entitlement
from backend.supabase_client import Client, create_client
from backend.auth import get_current_user

log = logging.getLogger("nexus.api_v1.middleware")

_redis_url_cache: str | None = None
r: redis.Redis | None = None

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
supabase: Client | None = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY) if SUPABASE_URL and SUPABASE_SERVICE_KEY else None

if not SUPABASE_URL:
    log.warning("SUPABASE_URL missing; API key persistence is limited to Redis fallback paths")
if not SUPABASE_SERVICE_KEY:
    log.warning("SUPABASE_SERVICE_KEY missing; API key persistence is limited to Redis fallback paths")

security_scheme = HTTPBearer(auto_error=False)

API_KEY_REDIS_USER_SET_PREFIX = "api_keys:user:"
API_KEY_REDIS_RECORD_PREFIX = "api_keys:record:"
API_KEY_OVERRIDE_REDIS_PREFIX = "api_keys:override:"


def _is_missing_table_error(error: Any, table: str) -> bool:
    if not isinstance(error, dict):
        return False
    if error.get("code") != "PGRST205":
        return False
    return f"public.{table}" in str(error.get("message") or "")


def _is_no_rows_error(error: Any) -> bool:
    if not isinstance(error, dict):
        return False
    code = str(error.get("code") or "").strip()
    details = str(error.get("details") or "")
    message = str(error.get("message") or "")
    return code == "PGRST116" or "0 rows" in details or "0 rows" in message


def _redis_api_key_record_key(key_id: str) -> str:
    return f"{API_KEY_REDIS_RECORD_PREFIX}{key_id}"


def _redis_api_key_user_set_key(user_id: str) -> str:
    return f"{API_KEY_REDIS_USER_SET_PREFIX}{user_id}"


def _redis_api_key_override_key(key_id: str) -> str:
    return f"{API_KEY_OVERRIDE_REDIS_PREFIX}{key_id}"


def _normalize_scopes(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def get_default_rate_limit_for_plan(plan: str | None) -> int:
    normalized = str(plan or "").strip().lower()
    if normalized == "enterprise":
        return 1200
    if normalized == "api_growth":
        return 480
    if normalized == "api":
        return 120
    return 60


def _sanitize_key_override_payload(updates: dict[str, Any]) -> dict[str, Any]:
    sanitized = dict(updates or {})
    integer_fields = {
        "custom_rate_limit",
        "custom_daily_quota",
        "custom_concurrency_limit",
        "retention_hours",
    }
    boolean_fields = {"webhooks_enabled"}
    string_fields = {"priority_lane", "notes", "plan_tier_override"}

    for field in integer_fields:
        if field in sanitized and sanitized[field] is not None:
            sanitized[field] = max(0, int(sanitized[field]))
    for field in boolean_fields:
        if field in sanitized and sanitized[field] is not None:
            sanitized[field] = bool(sanitized[field])
    for field in string_fields:
        if field in sanitized and sanitized[field] is not None:
            sanitized[field] = str(sanitized[field]).strip() or None
    if sanitized.get("plan_tier_override"):
        sanitized["plan_tier_override"] = str(sanitized["plan_tier_override"]).strip().lower()
    sanitized["updated_at"] = datetime.now(timezone.utc).isoformat()
    return sanitized


async def _load_profile_snapshot(user_id: str) -> dict[str, Any]:
    if not supabase:
        return {}
    try:
        result = supabase.table("profiles").select("*").eq("id", user_id).maybe_single().execute()
        return result.data or {}
    except Exception:
        return {}


async def create_api_key_record(record: dict[str, Any]) -> dict[str, Any]:
    payload = dict(record)
    payload.setdefault("id", str(uuid.uuid4()))
    payload.setdefault("created_at", datetime.now(timezone.utc).isoformat())
    payload.setdefault("status", "active")
    payload.setdefault("scopes", [])

    if supabase:
        result = supabase.table("api_keys").insert(payload).execute()
        if result.data:
            return result.data[0]
        if not _is_missing_table_error(result.error, "api_keys"):
            raise HTTPException(status_code=500, detail="Unable to generate B2B key right now.")

    redis_client = await ensure_redis_or_fail()
    await redis_client.set(_redis_api_key_record_key(payload["id"]), json.dumps(payload))
    await redis_client.sadd(_redis_api_key_user_set_key(str(payload["user_id"])), payload["id"])
    await redis_client.setex(f"key_meta:{payload['key_hash']}", 60, json.dumps(payload))
    return payload


async def get_api_key_record_for_user(user_id: str | None, key_id: str) -> dict[str, Any] | None:
    if supabase:
        query = supabase.table("api_keys").select("*").eq("id", key_id)
        if user_id:
            query = query.eq("user_id", user_id)
        result = query.maybe_single().execute()
        if result.data:
            return result.data
        if not _is_missing_table_error(result.error, "api_keys"):
            return None

    redis_client = await ensure_redis_or_fail()
    raw = await redis_client.get(_redis_api_key_record_key(key_id))
    if not raw:
        return None
    payload = json.loads(raw)
    if user_id and str(payload.get("user_id") or "") != str(user_id):
        return None
    return payload


async def list_api_keys_for_user(user_id: str) -> list[dict[str, Any]]:
    if supabase:
        result = supabase.table("api_keys").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
        if result.data is not None:
            return result.data or []
        if not _is_missing_table_error(result.error, "api_keys"):
            raise HTTPException(status_code=500, detail="Unable to load API keys right now.")

    redis_client = await ensure_redis_or_fail()
    key_ids = await redis_client.smembers(_redis_api_key_user_set_key(user_id))
    rows: list[dict[str, Any]] = []
    for key_id in key_ids:
        raw = await redis_client.get(_redis_api_key_record_key(key_id))
        if not raw:
            continue
        try:
            rows.append(json.loads(raw))
        except Exception:
            continue
    rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return rows


async def get_api_key_override(key_id: str) -> dict[str, Any] | None:
    if not key_id:
        return None

    if supabase:
        try:
            result = supabase.table("api_key_overrides").select("*").eq("key_id", key_id).maybe_single().execute()
            if result.data:
                return result.data
            if not (_is_missing_table_error(result.error, "api_key_overrides") or _is_no_rows_error(result.error)):
                return None
        except Exception:
            pass

    redis_client = await ensure_redis_or_fail()
    raw = await redis_client.get(_redis_api_key_override_key(key_id))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


async def upsert_api_key_override(
    key_id: str,
    updates: dict[str, Any],
    *,
    fallback_user_id: str | None = None,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    current = await get_api_key_override(key_id) or {"key_id": key_id}
    payload = _sanitize_key_override_payload({**current, **dict(updates or {})})
    payload["key_id"] = key_id
    if fallback_user_id and not payload.get("user_id"):
        payload["user_id"] = fallback_user_id
    if actor_user_id:
        payload["updated_by"] = actor_user_id

    persisted = payload
    if supabase:
        try:
            result = supabase.table("api_key_overrides").upsert(payload, on_conflict="key_id").execute()
            if result.data:
                persisted = result.data[0]
            elif not _is_missing_table_error(result.error, "api_key_overrides"):
                raise HTTPException(status_code=500, detail="Unable to persist Enterprise key controls right now.")
        except HTTPException:
            raise
        except Exception:
            persisted = payload

    redis_client = await ensure_redis_or_fail()
    await redis_client.set(_redis_api_key_override_key(key_id), json.dumps(persisted))
    return persisted


def apply_api_key_override_to_entitlement(
    entitlement: dict[str, Any],
    override: dict[str, Any] | None,
) -> dict[str, Any]:
    effective = dict(entitlement or {})
    if not override:
        return effective

    if override.get("custom_daily_quota") is not None:
        effective["api_request_limit_daily"] = int(override.get("custom_daily_quota") or 0)
    if override.get("custom_concurrency_limit") is not None:
        effective["max_concurrent_jobs"] = int(override.get("custom_concurrency_limit") or 0)
    if override.get("retention_hours") is not None:
        effective["retention_hours"] = int(override.get("retention_hours") or 0)
    if override.get("priority_lane"):
        effective["queue_priority"] = override.get("priority_lane")
    if override.get("webhooks_enabled") is not None:
        effective["webhook_delivery_enabled"] = bool(override.get("webhooks_enabled"))
    if override.get("plan_tier_override"):
        effective["plan"] = str(override.get("plan_tier_override") or effective.get("plan") or "").lower()
    return effective


async def get_api_key_record_by_hash(key_hash: str) -> dict[str, Any] | None:
    if supabase:
        result = (
            supabase.from_("api_keys")
            .select("*, profiles(*)")
            .eq("key_hash", key_hash)
            .eq("status", "active")
            .maybe_single()
            .execute()
        )
        if result.data:
            return result.data
        if not _is_missing_table_error(result.error, "api_keys"):
            return None

    redis_client = await ensure_redis_or_fail()
    cached = await redis_client.get(f"key_meta:{key_hash}")
    if cached:
        try:
            record = json.loads(cached)
        except Exception:
            record = None
        if record and str(record.get("status") or "active").lower() == "active":
            profile = await _load_profile_snapshot(str(record.get("user_id") or ""))
            if profile:
                record["profiles"] = profile
            return record

    user_set_keys = await redis_client.keys(f"{API_KEY_REDIS_USER_SET_PREFIX}*")
    for set_key in user_set_keys:
        key_ids = await redis_client.smembers(set_key)
        for key_id in key_ids:
            raw = await redis_client.get(_redis_api_key_record_key(key_id))
            if not raw:
                continue
            try:
                record = json.loads(raw)
            except Exception:
                continue
            if record.get("key_hash") != key_hash or str(record.get("status") or "").lower() != "active":
                continue
            profile = await _load_profile_snapshot(str(record.get("user_id") or ""))
            if profile:
                record["profiles"] = profile
            await redis_client.setex(f"key_meta:{key_hash}", 60, json.dumps(record))
            return record
    return None


async def revoke_api_key_for_user(user_id: str | None, key_id: str) -> dict[str, Any] | None:
    if supabase:
        query = supabase.table("api_keys").select("*").eq("id", key_id)
        if user_id:
            query = query.eq("user_id", user_id)
        record = query.maybe_single().execute()
        if record.data:
            update_query = supabase.table("api_keys").update({"status": "revoked"}).eq("id", key_id)
            if user_id:
                update_query = update_query.eq("user_id", user_id)
            update_query.execute()
            updated = dict(record.data)
            updated["status"] = "revoked"
            return updated
        if not _is_missing_table_error(record.error, "api_keys"):
            return None

    redis_client = await ensure_redis_or_fail()
    raw = await redis_client.get(_redis_api_key_record_key(key_id))
    if not raw:
        return None
    payload = json.loads(raw)
    if user_id and str(payload.get("user_id") or "") != str(user_id):
        return None
    payload["status"] = "revoked"
    await redis_client.set(_redis_api_key_record_key(key_id), json.dumps(payload))
    if payload.get("key_hash"):
        await redis_client.delete(f"key_meta:{payload['key_hash']}")
    return payload


async def update_api_key_record(
    user_id: str | None,
    key_id: str,
    updates: dict[str, Any],
) -> dict[str, Any] | None:
    sanitized = dict(updates)
    if "scopes" in sanitized:
        sanitized["scopes"] = _normalize_scopes(sanitized.get("scopes"))
    if "rate_limit" in sanitized and sanitized["rate_limit"] is not None:
        sanitized["rate_limit"] = max(1, int(sanitized["rate_limit"]))
    if "name" in sanitized and sanitized["name"] is not None:
        sanitized["name"] = str(sanitized["name"]).strip() or "Production Key"

    current = await get_api_key_record_for_user(user_id, key_id)
    if not current:
        return None

    if supabase:
        query = supabase.table("api_keys").update(sanitized).eq("id", key_id)
        if user_id:
            query = query.eq("user_id", user_id)
        result = query.execute()
        if result.data:
            updated = result.data[0]
        elif _is_missing_table_error(result.error, "api_keys"):
            redis_client = await ensure_redis_or_fail()
            updated = {**current, **sanitized}
            await redis_client.set(_redis_api_key_record_key(key_id), json.dumps(updated))
        else:
            raise HTTPException(status_code=500, detail="Unable to update API key right now.")
    else:
        redis_client = await ensure_redis_or_fail()
        updated = {**current, **sanitized}
        await redis_client.set(_redis_api_key_record_key(key_id), json.dumps(updated))

    redis_client = await ensure_redis_or_fail()
    key_hash = str(updated.get("key_hash") or "")
    if key_hash:
        await redis_client.setex(f"key_meta:{key_hash}", 60, json.dumps(updated))
    return updated


async def rotate_api_key_record(user_id: str | None, key_id: str) -> tuple[str, dict[str, Any]] | tuple[None, None]:
    current = await get_api_key_record_for_user(user_id, key_id)
    if not current:
        return None, None

    old_hash = current.get("key_hash")
    raw_key = f"nx_live_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    updated = await update_api_key_record(
        user_id,
        key_id,
        {
            "key_prefix": raw_key[:12],
            "key_hash": key_hash,
            "status": "active",
        },
    )
    if not updated:
        return None, None

    redis_client = await ensure_redis_or_fail()
    if old_hash:
        await redis_client.delete(f"key_meta:{old_hash}")
    await redis_client.setex(f"key_meta:{key_hash}", 60, json.dumps(updated))
    return raw_key, updated


async def list_all_api_keys(limit: int = 100) -> list[dict[str, Any]]:
    if supabase:
        result = supabase.table("api_keys").select("*").order("created_at", desc=True).limit(limit).execute()
        if result.data is not None:
            return result.data or []
        if not _is_missing_table_error(result.error, "api_keys"):
            return []

    redis_client = await ensure_redis_or_fail()
    rows: list[dict[str, Any]] = []
    for record_key in await redis_client.keys(f"{API_KEY_REDIS_RECORD_PREFIX}*"):
        raw = await redis_client.get(record_key)
        if not raw:
            continue
        try:
            rows.append(json.loads(raw))
        except Exception:
            continue
    rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return rows[:limit]


async def summarize_api_key_usage(key_id: str, *, days: int = 30, limit: int = 200) -> dict[str, Any]:
    if not supabase:
        return {
            "key_id": key_id,
            "events_total": 0,
            "success_requests": 0,
            "failed_requests": 0,
            "failure_rate_pct": 0.0,
            "response_code_family_counts": {},
            "daily_counts": {},
            "endpoint_counts": {},
            "response_code_counts": {},
            "recent_requests": [],
        }

    def _query() -> list[dict[str, Any]]:
        try:
            result = (
                supabase.table("api_request_logs")
                .select("*")
                .eq("api_key_id", key_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    rows = await asyncio.to_thread(_query)
    def _rollup_query() -> list[dict[str, Any]]:
        try:
            result = (
                supabase.table("api_key_usage_daily")
                .select("*")
                .eq("api_key_id", key_id)
                .order("day", desc=True)
                .limit(days)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    rollup_rows = await asyncio.to_thread(_rollup_query)
    recent_requests: list[dict[str, Any]] = []
    log_daily_counts: dict[str, int] = {}
    rollup_daily_counts: dict[str, int] = {}
    endpoint_counts: dict[str, int] = {}
    response_code_counts: dict[str, int] = {}
    response_code_family_counts: dict[str, int] = {}
    recent_ips: list[str] = []
    cutoff = datetime.now(timezone.utc).timestamp() - (days * 86400)
    success_requests = 0
    failed_requests = 0

    for row in rows:
        created_at = str(row.get("created_at") or "")
        day = created_at[:10] if created_at else ""
        endpoint = str(row.get("endpoint") or "unknown")
        response_code = str(row.get("response_code") or "unknown")
        endpoint_counts[endpoint] = endpoint_counts.get(endpoint, 0) + 1
        response_code_counts[response_code] = response_code_counts.get(response_code, 0) + 1
        family = f"{response_code[0]}xx" if len(response_code) == 3 and response_code.isdigit() else "other"
        response_code_family_counts[family] = response_code_family_counts.get(family, 0) + 1
        if response_code.isdigit():
            if int(response_code) >= 400:
                failed_requests += 1
            else:
                success_requests += 1

        try:
            created_ts = datetime.fromisoformat(created_at.replace("Z", "+00:00")).timestamp()
        except Exception:
            created_ts = None
        if day and (created_ts is None or created_ts >= cutoff):
            log_daily_counts[day] = log_daily_counts.get(day, 0) + 1

        ip_hint = row.get("last_ip")
        if ip_hint and ip_hint not in recent_ips:
            recent_ips.append(str(ip_hint))

        recent_requests.append(
            {
                "created_at": row.get("created_at"),
                "endpoint": row.get("endpoint"),
                "provider": row.get("provider"),
                "response_code": row.get("response_code"),
                "processing_ms": row.get("processing_ms"),
                "queue_wait_ms": row.get("queue_wait_ms"),
                "bytes_out": row.get("bytes_out"),
                "last_ip": row.get("last_ip"),
            }
        )

    for row in rollup_rows:
        day = str(row.get("day") or "")
        if not day:
            continue
        rollup_daily_counts[day] = int(row.get("request_count") or 0)

    total_requests = len(rows)
    failure_rate_pct = round((failed_requests / total_requests) * 100, 2) if total_requests else 0.0

    return {
        "key_id": key_id,
        "events_total": total_requests,
        "success_requests": success_requests,
        "failed_requests": failed_requests,
        "failure_rate_pct": failure_rate_pct,
        "response_code_family_counts": response_code_family_counts,
        "rollup_request_total": sum(rollup_daily_counts.values()),
        "daily_counts": rollup_daily_counts or log_daily_counts,
        "log_daily_counts": log_daily_counts,
        "rollup_daily_counts": rollup_daily_counts,
        "endpoint_counts": endpoint_counts,
        "response_code_counts": response_code_counts,
        "recent_ips": recent_ips[:10],
        "recent_requests": recent_requests[:20],
        "source": "rollup+logs" if rollup_daily_counts else "logs_only",
    }


def _get_redis_client() -> redis.Redis | None:
    global _redis_url_cache, r
    redis_url = os.environ.get("REDIS_URL")
    redis_password = os.environ.get("REDIS_PASSWORD")
    try:
        curr_loop = asyncio.get_running_loop()
        loop_id = id(curr_loop)
    except RuntimeError:
        loop_id = 0

    cache_key = f"{redis_url}::pass={bool(redis_password)}::loop={loop_id}"
    if cache_key != _redis_url_cache:
        _redis_url_cache = cache_key
        r = None
        if redis_url:
            try:
                # Merge REDIS_PASSWORD if provided and not already in URL
                target_url = redis_url
                if redis_password and "@" not in redis_url and "://" in redis_url:
                    from urllib.parse import quote
                    proto, rest = redis_url.split("://", 1)
                    target_url = f"{proto}://:{quote(redis_password)}@{rest}"

                connect_timeout = float(os.environ.get("NEXUS_REDIS_CONNECT_TIMEOUT", "2.0"))
                socket_timeout = float(os.environ.get("NEXUS_REDIS_SOCKET_TIMEOUT", "3.0"))
                health_interval = int(os.environ.get("NEXUS_REDIS_HEALTH_CHECK_INTERVAL", "15"))

                r = redis.from_url(
                    target_url,
                    decode_responses=True,
                    socket_connect_timeout=connect_timeout,
                    socket_timeout=socket_timeout,
                    health_check_interval=health_interval,
                    retry_on_timeout=True,
                )
            except Exception as exc:
                # Safely redact potential secrets from error message
                err_msg = str(exc)
                if redis_password:
                    err_msg = err_msg.replace(redis_password, "***")
                log.warning("Failed to initialize Redis client: %s", err_msg)
                r = None
    return r


async def get_redis_runtime_status() -> dict[str, Any]:
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        return {
            "configured": False,
            "available": False,
            "mode": "disabled",
            "detail": "REDIS_URL is not configured.",
        }
    redis_client = _get_redis_client()
    if redis_client is None:
        return {
            "configured": True,
            "available": False,
            "mode": "degraded",
            "detail": "Redis client initialization failed.",
        }
    try:
        await redis_client.ping()
        return {
            "configured": True,
            "available": True,
            "mode": "online",
            "detail": None,
        }
    except Exception as exc:
        return {
            "configured": True,
            "available": False,
            "mode": "degraded",
            "detail": str(exc),
        }


async def ensure_redis_or_fail() -> redis.Redis:
    redis_client = _get_redis_client()
    if redis_client is None:
        raise HTTPException(
            status_code=503,
            detail="Redis runtime is unavailable. Volatile control-plane protections are fail-closed.",
        )
    try:
        await redis_client.ping()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Redis runtime is unavailable. Volatile control-plane protections are fail-closed.",
        ) from exc
    return redis_client


async def is_user_blacklisted(user_id: str) -> bool:
    redis_client = await ensure_redis_or_fail()
    return bool(await redis_client.exists(f"blacklist:{user_id}"))


async def verify_b2b_key(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security_scheme),
) -> dict:
    key = None
    if credentials:
        key = credentials.credentials
        
    if not key:
        key = request.headers.get("X-Nexus-API-Key")
        
    if not key:
        raise HTTPException(
            status_code=401,
            detail="API Key missing. Pass X-Nexus-API-Key header or Bearer Authorization token."
        )

    if not (key.startswith("sk_live_") or key.startswith("sk_test_") or key.startswith("nx_live_") or key.startswith("nx_test_")):
        # Check if it could be a Supabase JWT token
        try:
            creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=key)
            user_data = await get_current_user(request=request, credentials=creds)
            if user_data and not user_data.get("anonymous"):
                user_id = user_data["id"]
                if await is_user_blacklisted(user_id):
                    raise HTTPException(
                        status_code=403,
                        detail="SOVEREIGN LOCKDOWN: Your account has been globally restricted.",
                    )
                plan = user_data.get("plan", "free")
                role = user_data.get("role", "user")
                is_owner = role in {"owner", "admin"}
                entitlement = user_data.get("entitlement") or {}
                
                # Check rate limits for web session
                if not is_owner:
                    redis_client = await ensure_redis_or_fail()
                    rate_limit = 15  # Default limit for web dashboard sessions
                    now = time.time()
                    key_bucket = f"ratelimit:web_session:{user_id}"
                    results = (
                        await redis_client.pipeline(transaction=True)
                        .get(key_bucket)
                        .set(key_bucket, now, px=int(60000 / rate_limit), nx=True)
                        .execute()
                    )
                    last_req_time = float(results[0]) if results[0] else 0
                    if (now - last_req_time) < (60.0 / rate_limit):
                        raise HTTPException(
                            status_code=429,
                            detail="Rate limit exceeded. Please wait before submitting another video.",
                        )
                    await redis_client.set(key_bucket, now)
                
                return {
                    "user_id": user_id,
                    "key_id": "web_session",
                    "plan": plan,
                    "role": role,
                    "is_owner": is_owner,
                    "limit_bypass": is_owner,
                    "scopes": ["extract"],
                    "entitlement": entitlement,
                    "enterprise_controls": {},
                }
        except HTTPException:
            raise
        except Exception as exc:
            log.warning("Supabase token verify fallback failed: %s", exc)
        
        raise HTTPException(status_code=401, detail="Invalid API Key format. Prefix missing.")

    redis_client = await ensure_redis_or_fail()
    key_hash = hashlib.sha256(key.encode()).hexdigest()

    cached_key = await redis_client.get(f"key_meta:{key_hash}")
    if cached_key:
        key_data = json.loads(cached_key)
    else:
        key_data = await get_api_key_record_by_hash(key_hash)
        if not key_data:
            raise HTTPException(status_code=401, detail="API Key is invalid or revoked.")
        await redis_client.setex(f"key_meta:{key_hash}", 60, json.dumps(key_data))

    user_id = key_data["user_id"]
    if await is_user_blacklisted(user_id):
        raise HTTPException(
            status_code=403,
            detail="SOVEREIGN LOCKDOWN: Your account has been globally restricted.",
        )

    from backend.auth import resolve_user_role

    profile_data = key_data.get("profiles") or {}
    key_override = await get_api_key_override(str(key_data.get("id") or ""))
    effective_plan = str(
        (key_override.get("plan_tier_override") if key_override else None)
        or profile_data.get("plan")
        or key_data.get("plan_tier")
        or "api"
    ).strip().lower()
    role = resolve_user_role(profile_data, {})
    is_owner = role in {"owner", "admin"}
    effective_user = {
        "id": user_id,
        "email": profile_data.get("email"),
        "plan": effective_plan,
        "role": role,
        "is_owner": is_owner,
        "limit_bypass": is_owner,
        "anonymous": False,
        "account_status": profile_data.get("account_status", "active"),
    }
    if effective_user["account_status"] not in {"active", ""} and not is_owner:
        raise HTTPException(
            status_code=403,
            detail="SOVEREIGN LOCKDOWN: Your account has been globally restricted.",
        )
    entitlement = apply_api_key_override_to_entitlement(build_effective_entitlement(effective_user), key_override)
    rate_limit = int(
        (key_override.get("custom_rate_limit") if key_override else None)
        or key_data.get("rate_limit")
        or get_default_rate_limit_for_plan(effective_plan)
    )

    if not is_owner:
        now = time.time()
        key_bucket = f"ratelimit:{key_hash}"
        results = (
            await redis_client.pipeline(transaction=True)
            .get(key_bucket)
            .set(key_bucket, now, px=int(60000 / rate_limit), nx=True)
            .execute()
        )
        last_req_time = float(results[0]) if results[0] else 0
        if (now - last_req_time) < (60.0 / rate_limit):
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded ({rate_limit} RPM). Upgrade your B2B tier for higher throughput.",
            )

        await redis_client.set(key_bucket, now)
        has_custom_daily_quota = key_override is not None and key_override.get("custom_daily_quota") is not None
        daily_usage_key = (
            f"api_usage_daily:key:{key_data['id']}"
            if has_custom_daily_quota
            else f"api_usage_daily:{user_id}"
        )
        daily_usage = await redis_client.incr(daily_usage_key)
        await redis_client.expire(daily_usage_key, 86400)
        daily_cap = int(entitlement.get("api_request_limit_daily") or 0)
        if daily_cap and daily_usage > daily_cap:
            raise HTTPException(
                status_code=429,
                detail="API daily quota reached for the active key policy.",
            )

    ip_hint = request.client.host if request and request.client else None

    await _touch_key_last_used(
        key_id=key_data["id"],
        ip_hint=ip_hint,
    )

    return {
        "user_id": user_id,
        "key_id": key_data["id"],
        "plan": effective_plan,
        "role": role,
        "is_owner": is_owner,
        "limit_bypass": is_owner,
        "scopes": key_data["scopes"] or [],
        "entitlement": entitlement,
        "enterprise_controls": key_override or {},
    }


async def _touch_key_last_used(*, key_id: str, ip_hint: Optional[str]) -> None:
    def _write() -> None:
        if not supabase:
            return
        try:
            current_timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            result = supabase.table("api_keys").update(
                {
                    "last_used_at": current_timestamp,
                    "last_ip": ip_hint,
                }
            ).eq("id", key_id).execute()

            if _is_missing_table_error(getattr(result, "error", None), "api_keys"):
                return
        except Exception as exc:
            log.debug("Skipping API key last-used sync for key %s: %s", key_id, exc)

    await asyncio.to_thread(_write)

    try:
        redis_client = await ensure_redis_or_fail()
        raw = await redis_client.get(_redis_api_key_record_key(key_id))
        if raw:
            payload = json.loads(raw)
            payload["last_used_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            payload["last_ip"] = ip_hint
            await redis_client.set(_redis_api_key_record_key(key_id), json.dumps(payload))
            if payload.get("key_hash"):
                await redis_client.setex(f"key_meta:{payload['key_hash']}", 60, json.dumps(payload))
    except Exception as exc:
        log.debug("Skipping Redis API key usage sync for key %s: %s", key_id, exc)


async def record_api_request_result(
    *,
    key_id: str,
    user_id: str,
    endpoint: str,
    provider: Optional[str],
    response_code: int,
    ip_hint: Optional[str],
    processing_ms: Optional[int] = None,
    queue_wait_ms: Optional[int] = None,
    bytes_out: Optional[int] = None,
) -> None:
    def _write() -> None:
        if not supabase:
            return
        try:
            current_timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            current_day = time.strftime("%Y-%m-%d", time.gmtime())

            log_result = supabase.table("api_request_logs").insert(
                {
                    "api_key_id": key_id,
                    "user_id": user_id,
                    "endpoint": endpoint,
                    "provider": provider,
                    "response_code": response_code,
                    "last_ip": ip_hint,
                    "processing_ms": processing_ms,
                    "queue_wait_ms": queue_wait_ms,
                    "bytes_out": bytes_out,
                    "created_at": current_timestamp,
                }
            ).execute()
            if log_result.error and not _is_missing_table_error(log_result.error, "api_request_logs"):
                raise RuntimeError(str(log_result.error))

            usage_result = (
                supabase.table("api_key_usage_daily")
                .select("*")
                .eq("api_key_id", key_id)
                .eq("day", current_day)
                .maybe_single()
                .execute()
            )
            if usage_result.error and not _is_missing_table_error(usage_result.error, "api_key_usage_daily") and not _is_no_rows_error(usage_result.error):
                raise RuntimeError(str(usage_result.error))

            if usage_result.data:
                current_count = int(usage_result.data.get("request_count") or 0)
                update_result = supabase.table("api_key_usage_daily").update(
                    {
                        "request_count": current_count + 1,
                        "updated_at": current_timestamp,
                    }
                ).eq("api_key_id", key_id).eq("day", current_day).execute()
                if update_result.error and not _is_missing_table_error(update_result.error, "api_key_usage_daily"):
                    raise RuntimeError(str(update_result.error))
            else:
                usage_payload = {
                    "api_key_id": key_id,
                    "user_id": user_id,
                    "day": current_day,
                    "request_count": 1,
                    "updated_at": current_timestamp,
                }
                insert_result = supabase.table("api_key_usage_daily").insert(usage_payload).execute()
                if insert_result.error and not _is_missing_table_error(insert_result.error, "api_key_usage_daily"):
                    usage_payload["user_id"] = None
                    insert_result = supabase.table("api_key_usage_daily").insert(usage_payload).execute()
                if insert_result.error and not _is_missing_table_error(insert_result.error, "api_key_usage_daily"):
                    raise RuntimeError(str(insert_result.error))
        except Exception as exc:
            log.debug("Skipping API request telemetry sync for key %s: %s", key_id, exc)

    await asyncio.to_thread(_write)
