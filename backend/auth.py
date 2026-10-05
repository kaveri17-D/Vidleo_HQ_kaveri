import hashlib
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from dotenv import load_dotenv

from backend.entitlements import build_effective_entitlement
from backend.supabase_client import Client, create_client

log = logging.getLogger("nexus.auth")

load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=False)

# Initialize Supabase Client
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET")

if not SUPABASE_URL:
    log.warning("SUPABASE_URL missing in backend/.env")
if not SUPABASE_SERVICE_KEY:
    log.warning("SUPABASE_SERVICE_KEY missing in backend/.env; server-side Supabase access is disabled")
if not SUPABASE_JWT_SECRET:
    log.warning("SUPABASE_JWT_SECRET missing in backend/.env")

supabase: Client | None = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY) if SUPABASE_URL and SUPABASE_SERVICE_KEY else None

security = HTTPBearer(auto_error=False)
OWNER_ROLES = {"owner", "admin"}


def _split_env_set(value: Optional[str]) -> set[str]:
    if not value:
        return set()
    return {item.strip().lower() for item in value.split(",") if item.strip()}


OWNER_EMAILS = _split_env_set(os.environ.get("OWNER_EMAILS") or os.environ.get("OWNER_EMAIL"))
OWNER_USER_IDS = _split_env_set(os.environ.get("OWNER_USER_IDS"))
PREMIUM_EMAILS = _split_env_set(os.environ.get("PREMIUM_EMAILS") or os.environ.get("PREMIUM_EMAIL"))
PREMIUM_USER_IDS = _split_env_set(os.environ.get("PREMIUM_USER_IDS"))


def _load_active_subscription(user_id: str) -> Optional[dict]:
    if not supabase or not user_id:
        return None
    try:
        res = (
            supabase.table("subscriptions")
            .select("plan_code,status,current_period_end,provider,provider_subscription_id")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        subscription = res.data or None
        if not subscription:
            return None

        if str(subscription.get("status") or "").strip().lower() not in {"active", "trialing"}:
            return None
        return subscription
    except Exception as exc:
        log.warning("Subscription lookup failed for user %s: %s", user_id, exc)
        return None


def _default_credit_grants() -> dict[str, Any]:
    return {
        "bonus_download_credits": 0,
        "bonus_api_credits": 0,
        "notes": None,
        "updated_by": None,
        "updated_at": None,
        "created_at": None,
    }


def _load_credit_grants(user_id: str) -> dict[str, Any]:
    if not supabase or not user_id:
        return _default_credit_grants()
    try:
        res = (
            supabase.table("user_credit_grants")
            .select("*")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        data = res.data or {}
        merged = _default_credit_grants()
        merged.update(data)
        merged["bonus_download_credits"] = int(merged.get("bonus_download_credits") or 0)
        merged["bonus_api_credits"] = int(merged.get("bonus_api_credits") or 0)
        return merged
    except Exception:
        return _default_credit_grants()


def load_credit_grants(user_id: str) -> dict[str, Any]:
    return _load_credit_grants(user_id)


def grant_credit_grants(
    user_id: str,
    *,
    bonus_download_credits: int,
    bonus_api_credits: int,
    actor_user_id: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    if not supabase or not user_id:
        return _default_credit_grants()

    payload = {
        "user_id": user_id,
        "bonus_download_credits": max(0, int(bonus_download_credits)),
        "bonus_api_credits": max(0, int(bonus_api_credits)),
        "notes": notes,
        "updated_by": actor_user_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    current = _load_credit_grants(user_id)

    try:
        if current.get("created_at"):
            result = (
                supabase.table("user_credit_grants")
                .update(payload)
                .eq("user_id", user_id)
                .execute()
            )
        else:
            payload["created_at"] = datetime.now(timezone.utc).isoformat()
            result = supabase.table("user_credit_grants").insert(payload).execute()
        if getattr(result, "data", None):
            merged = _default_credit_grants()
            merged.update(result.data[0])
            merged["bonus_download_credits"] = int(merged.get("bonus_download_credits") or 0)
            merged["bonus_api_credits"] = int(merged.get("bonus_api_credits") or 0)
            return merged
    except Exception:
        return current

    return _load_credit_grants(user_id)


def _enforce_account_access(user: dict) -> dict:
    if user.get("limit_bypass"):
        return user

    account_status = str(user.get("account_status") or "active").strip().lower()
    if account_status not in {"", "active"}:
        raise HTTPException(
            status_code=403,
            detail="Your account is restricted across NEXUS services.",
        )
    return user


def fetch_supabase_user_payload(token: str) -> Optional[dict]:
    if not SUPABASE_URL:
        return None

    api_key = SUPABASE_SERVICE_KEY
    if not api_key:
        return None

    try:
        with httpx.Client() as client:
            response = client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": api_key,
                },
                timeout=10.0,
            )

        if response.status_code >= 400:
            log.warning("Supabase token fallback rejected request with status %s", response.status_code)
            return None

        user = response.json()
        return {
            "sub": user.get("id"),
            "email": user.get("email"),
            "app_metadata": user.get("app_metadata") or {},
            "user_metadata": user.get("user_metadata") or {},
            "role": user.get("role"),
        }
    except Exception as exc:
        log.error("Supabase auth fallback failed: %s", exc)
        return None


def normalize_role(value: Any) -> str:
    role = str(value or "").strip().lower()
    if role in OWNER_ROLES:
        return role
    if role in {"pro", "api"}:
        return "user"
    return "user"


def resolve_user_role(profile: Optional[dict] = None, payload: Optional[dict] = None) -> str:
    profile = profile or {}
    payload = payload or {}

    role_candidates = [
        profile.get("role"),
        (payload.get("app_metadata") or {}).get("role"),
        (payload.get("user_metadata") or {}).get("role"),
        payload.get("role"),
    ]

    for candidate in role_candidates:
        role = normalize_role(candidate)
        if role in OWNER_ROLES:
            return role

    user_id = str(profile.get("id") or payload.get("sub") or "").strip().lower()
    email = str(profile.get("email") or payload.get("email") or "").strip().lower()

    if user_id and user_id in OWNER_USER_IDS:
        return "owner"
    if email and email in OWNER_EMAILS:
        return "owner"

    return "user"


def enrich_user_record(profile: Optional[dict] = None, payload: Optional[dict] = None) -> dict:
    profile = dict(profile or {})
    payload = payload or {}

    user_id = str(profile.get("id") or payload.get("sub") or "").strip()
    active_subscription = _load_active_subscription(user_id) if user_id else None
    credit_grants = _load_credit_grants(user_id) if user_id else _default_credit_grants()
    email = str(profile.get("email") or payload.get("email") or "").strip().lower()
    jwt_plan = (payload.get("app_metadata") or {}).get("plan") or (payload.get("user_metadata") or {}).get("plan")

    if (email and email in PREMIUM_EMAILS) or (user_id and user_id.lower() in PREMIUM_USER_IDS):
        effective_plan = "premium"
    elif active_subscription:
        effective_plan = active_subscription.get("plan_code")
    elif profile.get("plan") and profile.get("plan") != "free":
        effective_plan = profile.get("plan")
    elif jwt_plan:
        effective_plan = jwt_plan
    elif profile.get("plan"):
        effective_plan = profile.get("plan")
    else:
        effective_plan = "free"

    role = resolve_user_role(profile, payload)
    is_owner = role in OWNER_ROLES
    is_owner = role in OWNER_ROLES

    user = {
        "id": user_id or None,
        "email": profile.get("email") or payload.get("email") or "anonymous",
        "plan": effective_plan or "free",
        "downloads_today": profile.get("downloads_today", 0) or 0,
        "role": role,
        "is_owner": is_owner,
        "limit_bypass": is_owner,
        "anonymous": False,
        "account_status": profile.get("account_status") or "active",
        "subscription": active_subscription,
        "bonus_download_credits": int(credit_grants.get("bonus_download_credits") or 0),
        "bonus_api_credits": int(credit_grants.get("bonus_api_credits") or 0),
        "credit_grants": credit_grants,
    }

    for key, value in profile.items():
        if key not in user:
            user[key] = value

    user["entitlement"] = build_effective_entitlement(user)
    return user


async def enforce_consumer_rate_limit(
    request: Request,
    user: dict,
    scope: str,
    limit: int,
    window_seconds: int = 60,
) -> None:
    if user.get("limit_bypass"):
        return

    from backend.api_v1.middleware import _get_redis_client

    redis_client = _get_redis_client()
    if redis_client is None:
        # Redis unavailable — degrade gracefully, skip rate limiting
        log.warning("Redis unavailable — skipping rate limit enforcement for scope=%s", scope)
        return

    identifier = user.get("id")
    if not identifier:
        ua = request.headers.get("User-Agent", "anonymous")
        ip = request.client.host if request.client else "unknown"
        identifier = f"anon:{hashlib.sha256(f'{ip}:{ua}'.encode()).hexdigest()}"

    bucket = int(time.time() // window_seconds)
    rate_key = f"consumer_rate:{scope}:{identifier}:{bucket}"
    try:
        current = await redis_client.incr(rate_key)
        await redis_client.expire(rate_key, window_seconds + 5)
    except Exception as exc:
        log.warning("Redis rate limit check failed, degrading gracefully: %s", exc)
        return

    if current > limit:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded for {scope}. Please wait before trying again.",
        )


async def check_user_limit(user_or_id: str | dict) -> dict:
    """
    Sovereign Atomic Usage Engine (L9 Code Red):
    The 'Daily Truth' is cached in Redis for sub-1ms lookups and 100% burst protection.
    This check is now read-only to eliminate phantom scan deductions.
    """
    from backend.api_v1.middleware import _get_redis_client

    redis_client = _get_redis_client()

    if isinstance(user_or_id, dict):
        user = user_or_id
        if user.get("limit_bypass"):
            return {"success": True, "limit_exceeded": False, "bypassed": True}
        user_id = user.get("id")
        entitlement = user.get("entitlement") or build_effective_entitlement(user)
        limit = int(entitlement.get("download_limit_daily") or 0)
    else:
        user_id = user_or_id
        limit = int(build_effective_entitlement({"plan": "free", "role": "user"}).get("download_limit_daily") or 0)

    if not user_id:
        return {"success": True, "limit_exceeded": False}

    # If Redis is unavailable, degrade gracefully — allow traffic through
    if redis_client is None:
        log.warning("Redis unavailable — skipping usage limit check for user=%s", user_id)
        return {"success": True, "limit_exceeded": False}

    usage_key = f"download_usage_buffer:{user_id}"

    try:
        current_usage = await redis_client.get(usage_key)
        if limit > 0 and current_usage and int(current_usage) >= limit:
            if limit and supabase is None:
                return {"success": True, "limit_exceeded": True}
            if limit:
                res = supabase.table("profiles").select("*").eq("id", user_id).maybe_single().execute()
                if res.data:
                    effective_user = enrich_user_record(res.data, {})
                    effective_limit = int((effective_user.get("entitlement") or {}).get("download_limit_daily") or 0)
                    if not effective_user.get("limit_bypass") and effective_limit > 0:
                        return {"success": True, "limit_exceeded": True}
    except Exception as exc:
        log.warning("Redis usage check failed, degrading gracefully: %s", exc)

    return {"success": True, "limit_exceeded": False}


async def increment_user_download_count(user_id: str) -> int:
    """
    Sovereign Atomic Usage Engine Increment:
    Atomically increments the usage counter in Redis and applies an 86400s (24h) TTL if missing.
    """
    if not user_id:
        return 0

    from backend.api_v1.middleware import _get_redis_client
    redis_client = _get_redis_client()

    if redis_client is None:
        log.warning("Redis unavailable — skipping usage limit increment for user=%s", user_id)
        return 0

    usage_key = f"download_usage_buffer:{user_id}"

    try:
        current = await redis_client.incr(usage_key)
        ttl = await redis_client.ttl(usage_key)
        if ttl < 0:
            await redis_client.expire(usage_key, 86400)
        log.info("Incremented daily usage for user %s to %d (TTL: %d)", user_id, current, ttl)
        return current
    except Exception as exc:
        log.warning("Redis usage increment failed: %s", exc)
        return 0


def get_tiered_limit_reached_message(user_or_id: str | dict) -> str:
    """
    Returns a custom, psychologically-positioned upgrade message based on the user's current plan.
    """
    plan = "free"
    is_anon = False

    if isinstance(user_or_id, dict):
        user = user_or_id
        plan = user.get("plan") or "free"
        is_anon = bool(user.get("anonymous"))
    else:
        user_id = user_or_id
        if not user_id:
            is_anon = True
        elif supabase:
            try:
                res = supabase.table("profiles").select("*").eq("id", user_id).maybe_single().execute()
                if res.data:
                    user = enrich_user_record(res.data, {})
                    plan = user.get("plan") or "free"
                    is_anon = bool(user.get("anonymous"))
            except Exception:
                pass

    if is_anon:
        return (
            "Daily guest limit reached. Your active signal scans remain open, but downloads are paused. "
            "⚡ Boost your potential: Sign in to unlock more free daily downloads, or upgrade to Pro "
            "for 100 high-speed daily extractions, pristine 1080p quality, and cloud history!"
        )

    plan = str(plan).strip().lower()

    if plan == "free":
        return (
            "Daily limit reached. Your active signal scans remain open, but downloads are paused. "
            "🚀 Unleash continuous extraction: Upgrade to Pro now to unlock 100 high-speed daily downloads, "
            "crystal-clear 1080p quality, and cloud history. Never let limits slow down your creative workflow!"
        )
    elif plan == "pro":
        return (
            "Daily limit reached. Your active signal scans remain open, but downloads are paused. "
            "🔥 Take it to the next level: Upgrade to Premium now to expand your capacity to 500 daily downloads, "
            "pristine 4K Ultra-HD resolution, and our highest priority routing lane!"
        )
    elif plan in {"premium", "api", "api_growth", "enterprise"}:
        return (
            "Daily limit reached. Your active signal scans remain open, but downloads are paused. "
            "👑 High-volume power user: Unlock dedicated high-speed infrastructure, custom rate-limits, "
            "and provisioned API keys. Upgrade to our API or Enterprise lanes to scale without boundaries!"
        )

    return (
        "Daily download limit reached. Scanning stays open, but downloads are paused. "
        "Upgrade your plan to unlock more daily downloads and premium capabilities."
    )


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """
    Dependency to get the current user from the Supabase JWT.
    If no token is provided, returns an anonymous 'free' user.
    """
    origin = str(request.headers.get("origin") or "").lower()
    referer = str(request.headers.get("referer") or "").lower()
    explicit_client = str(
        request.headers.get("x-nexus-client")
        or request.headers.get("x-client-type")
        or request.headers.get("x-client-surface")
        or ""
    ).strip().lower()
    user_agent = str(request.headers.get("user-agent") or "").lower()
    is_extension_request = (
        explicit_client == "extension"
        or origin.startswith("chrome-extension://")
        or origin.startswith("moz-extension://")
        or referer.startswith("chrome-extension://")
        or referer.startswith("moz-extension://")
        or "chrome-extension" in user_agent
        or "moz-extension" in user_agent
    )

    anon_user = {
        "id": None,
        "email": "anonymous",
        "plan": "free",
        "downloads_today": 0,
        "role": "guest",
        "is_owner": False,
        "limit_bypass": False,
        "anonymous": True,
        "account_status": "active",
        "client_surface": "extension" if is_extension_request else "web",
    }
    anon_user["entitlement"] = build_effective_entitlement(anon_user)

    token = None
    if credentials:
        token = credentials.credentials
    elif "sb-access-token" in request.cookies:
        token = request.cookies.get("sb-access-token")

    if not token:
        return anon_user

    try:
        payload = None

        if SUPABASE_JWT_SECRET:
            try:
                payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated")
            except jwt.ExpiredSignatureError:
                log.warning("JWT expired")
                return anon_user
            except jwt.InvalidTokenError as exc:
                log.warning("JWT decode error, falling back to Supabase auth lookup: %s", exc)

        if payload is None:
            payload = fetch_supabase_user_payload(token)

        if not payload:
            return anon_user

        user_id = payload.get("sub")

        if not user_id:
            return anon_user

        if not supabase:
            fallback_profile = {
                "id": user_id,
                "email": payload.get("email"),
                "plan": "free",
                "downloads_today": 0,
            }
            return _enforce_account_access(enrich_user_record(fallback_profile, payload))

        res = supabase.table("profiles").select("*").eq("id", user_id).maybe_single().execute()

        if res.data:
            return _enforce_account_access(enrich_user_record(res.data, payload))

        fallback_profile = {
            "id": user_id,
            "email": payload.get("email"),
            "plan": "free",
            "downloads_today": 0,
        }
        return _enforce_account_access(enrich_user_record(fallback_profile, payload))

    except Exception as exc:
        log.error("Unexpected auth error: %s", exc)
        return anon_user
