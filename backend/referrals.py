from __future__ import annotations

import asyncio
import os
import re
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.auth import get_current_user, grant_credit_grants, load_credit_grants, supabase

router = APIRouter(prefix="/api/referrals", tags=["referrals"])

REFERRAL_CODE_LENGTH = max(6, int(os.environ.get("REFERRAL_CODE_LENGTH", "8")))
REFERRAL_REWARD_DOWNLOAD_REFERRER = max(0, int(os.environ.get("REFERRAL_REWARD_DOWNLOAD_REFERRER", "15")))
REFERRAL_REWARD_API_REFERRER = max(0, int(os.environ.get("REFERRAL_REWARD_API_REFERRER", "500")))
REFERRAL_REWARD_DOWNLOAD_REFERRED = max(0, int(os.environ.get("REFERRAL_REWARD_DOWNLOAD_REFERRED", "10")))
REFERRAL_REWARD_API_REFERRED = max(0, int(os.environ.get("REFERRAL_REWARD_API_REFERRED", "250")))


class ReferralClaimPayload(BaseModel):
    code: str


def _referral_reward_policy() -> dict[str, int]:
    return {
        "referrer_download_credits": REFERRAL_REWARD_DOWNLOAD_REFERRER,
        "referrer_api_credits": REFERRAL_REWARD_API_REFERRER,
        "referred_download_credits": REFERRAL_REWARD_DOWNLOAD_REFERRED,
        "referred_api_credits": REFERRAL_REWARD_API_REFERRED,
    }


def _normalize_referral_code(value: object) -> str:
    text = re.sub(r"[^A-Za-z0-9]", "", str(value or "")).upper()
    return text[: max(REFERRAL_CODE_LENGTH, 1)]


def _build_referral_code() -> str:
    return _normalize_referral_code(secrets.token_hex(REFERRAL_CODE_LENGTH))[:REFERRAL_CODE_LENGTH]


def _normalize_referral_event_row(row: dict[str, Any], *, source: str) -> dict[str, Any]:
    payload = dict(row.get("payload") or {})
    if source == "referral_events":
        return {
            "id": row.get("id"),
            "event_type": str(row.get("event_type") or "unknown").lower(),
            "status": str(row.get("status") or "active").lower(),
            "referral_code": _normalize_referral_code(row.get("referral_code")),
            "referrer_user_id": row.get("referrer_user_id"),
            "referred_user_id": row.get("referred_user_id"),
            "reward_download_credits": int(row.get("reward_download_credits") or 0),
            "reward_api_credits": int(row.get("reward_api_credits") or 0),
            "detail": row.get("detail"),
            "payload": payload,
            "created_at": row.get("created_at"),
            "source": "referral_events",
        }

    return {
        "id": row.get("id"),
        "event_type": str(row.get("event_type") or "unknown").lower(),
        "status": str(payload.get("status") or "active").lower(),
        "referral_code": _normalize_referral_code(payload.get("referral_code")),
        "referrer_user_id": payload.get("referrer_user_id"),
        "referred_user_id": payload.get("referred_user_id") or row.get("user_id"),
        "reward_download_credits": int(payload.get("reward_download_credits") or 0),
        "reward_api_credits": int(payload.get("reward_api_credits") or 0),
        "detail": row.get("detail"),
        "payload": payload,
        "created_at": row.get("created_at"),
        "source": "abuse_events",
    }


def _build_referral_event_snapshot(
    *,
    event_type: str,
    referral_code: str,
    referrer_user_id: str | None,
    referred_user_id: str | None,
    reward_download_credits: int,
    reward_api_credits: int,
    status: str,
    detail: str | None,
    payload: dict[str, Any],
    source: str,
) -> dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    if source == "referral_events":
        return {
            "event_type": event_type,
            "status": status,
            "referral_code": referral_code,
            "referrer_user_id": referrer_user_id,
            "referred_user_id": referred_user_id,
            "reward_download_credits": int(reward_download_credits or 0),
            "reward_api_credits": int(reward_api_credits or 0),
            "detail": detail,
            "payload": payload,
            "created_at": created_at,
            "source": "referral_events",
        }

    return {
        "user_id": referred_user_id or referrer_user_id,
        "event_type": event_type,
        "detail": detail,
        "payload": payload,
        "created_at": created_at,
        "source": "abuse_events",
    }


def _primary_referral_event_payload(
    *,
    event_type: str,
    referral_code: str,
    referrer_user_id: str | None,
    referred_user_id: str | None,
    reward_download_credits: int,
    reward_api_credits: int,
    status: str,
    detail: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        "event_type": event_type,
        "status": status,
        "referral_code": referral_code,
        "referrer_user_id": referrer_user_id,
        "referred_user_id": referred_user_id,
        "reward_download_credits": int(reward_download_credits or 0),
        "reward_api_credits": int(reward_api_credits or 0),
        "detail": detail,
        "payload": payload,
    }


def _read_referral_event_primary(
    *,
    event_type: str,
    referral_code: str | None,
    referrer_user_id: str | None,
    referred_user_id: str | None,
    status: str | None,
) -> dict[str, Any] | None:
    if not supabase:
        return None

    query = supabase.table("referral_events").select("*").order("created_at", desc=True).limit(1)
    query = query.eq("event_type", str(event_type).lower())
    if referral_code:
        query = query.eq("referral_code", _normalize_referral_code(referral_code))
    if referrer_user_id:
        query = query.eq("referrer_user_id", referrer_user_id)
    if referred_user_id:
        query = query.eq("referred_user_id", referred_user_id)
    if status:
        query = query.eq("status", str(status).lower())
    result = query.execute()
    rows = result.data or []
    if not rows:
        return None
    return _normalize_referral_event_row(rows[0], source="referral_events")


def _persist_referral_event_primary(
    *,
    event_type: str,
    referral_code: str,
    referrer_user_id: str | None,
    referred_user_id: str | None,
    reward_download_credits: int,
    reward_api_credits: int,
    status: str,
    detail: str | None,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    if not supabase:
        return None

    record = _primary_referral_event_payload(
        event_type=event_type,
        referral_code=referral_code,
        referrer_user_id=referrer_user_id,
        referred_user_id=referred_user_id,
        reward_download_credits=reward_download_credits,
        reward_api_credits=reward_api_credits,
        status=status,
        detail=detail,
        payload=payload,
    )
    result = supabase.table("referral_events").insert(record).execute()
    rows = result.data or []
    if rows:
        return _normalize_referral_event_row(rows[0], source="referral_events")
    return _read_referral_event_primary(
        event_type=event_type,
        referral_code=referral_code,
        referrer_user_id=referrer_user_id,
        referred_user_id=referred_user_id,
        status=status,
    )


async def _insert_referral_event(
    *,
    event_type: str,
    referral_code: str,
    referrer_user_id: str | None,
    referred_user_id: str | None,
    reward_download_credits: int = 0,
    reward_api_credits: int = 0,
    status: str = "active",
    detail: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not supabase:
        return {
            "event_type": event_type,
            "status": status,
            "referral_code": referral_code,
            "referrer_user_id": referrer_user_id,
            "referred_user_id": referred_user_id,
            "reward_download_credits": reward_download_credits,
            "reward_api_credits": reward_api_credits,
            "detail": detail,
            "payload": payload or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source": "memory",
        }

    event_payload = {
        "referral_code": referral_code,
        "referrer_user_id": referrer_user_id,
        "referred_user_id": referred_user_id,
        "reward_download_credits": int(reward_download_credits or 0),
        "reward_api_credits": int(reward_api_credits or 0),
        "status": status,
        **(payload or {}),
    }
    referral_row_fallback = _build_referral_event_snapshot(
        event_type=event_type,
        referral_code=referral_code,
        referrer_user_id=referrer_user_id,
        referred_user_id=referred_user_id,
        reward_download_credits=reward_download_credits,
        reward_api_credits=reward_api_credits,
        status=status,
        detail=detail,
        payload=event_payload,
        source="referral_events",
    )
    abuse_row_fallback = _build_referral_event_snapshot(
        event_type=event_type,
        referral_code=referral_code,
        referrer_user_id=referrer_user_id,
        referred_user_id=referred_user_id,
        reward_download_credits=reward_download_credits,
        reward_api_credits=reward_api_credits,
        status=status,
        detail=detail,
        payload=event_payload,
        source="abuse_events",
    )

    def _query() -> dict[str, Any]:
        try:
            primary_row = _persist_referral_event_primary(
                event_type=event_type,
                referral_code=referral_code,
                referrer_user_id=referrer_user_id,
                referred_user_id=referred_user_id,
                reward_download_credits=reward_download_credits,
                reward_api_credits=reward_api_credits,
                status=status,
                detail=detail,
                payload=event_payload,
            )
            if primary_row:
                return primary_row
            raise RuntimeError("referral_events insert returned no persisted row")
        except Exception:
            try:
                result = (
                    supabase.table("abuse_events")
                    .insert(
                        {
                            "user_id": abuse_row_fallback.get("user_id"),
                            "event_type": event_type,
                            "detail": detail,
                            "payload": event_payload,
                        }
                    )
                    .execute()
                )
                data = (result.data or [abuse_row_fallback])[0]
                normalized = _normalize_referral_event_row(data, source="abuse_events")
                if not normalized.get("referral_code"):
                    normalized = _normalize_referral_event_row(abuse_row_fallback, source="abuse_events")
                return normalized
            except Exception:
                return {
                    "event_type": event_type,
                    "status": status,
                    "referral_code": referral_code,
                    "referrer_user_id": referrer_user_id,
                    "referred_user_id": referred_user_id,
                    "reward_download_credits": int(reward_download_credits or 0),
                    "reward_api_credits": int(reward_api_credits or 0),
                    "detail": detail,
                    "payload": event_payload,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "source": "memory",
                }

    return await asyncio.to_thread(_query)


async def _fetch_referral_events(
    *,
    limit: int = 500,
    event_type: str | None = None,
    referral_code: str | None = None,
    referrer_user_id: str | None = None,
    referred_user_id: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    if not supabase:
        return []

    normalized_code = _normalize_referral_code(referral_code) if referral_code else None

    def _query() -> list[dict[str, Any]]:
        try:
            query = supabase.table("referral_events").select("*").order("created_at", desc=True).limit(limit)
            if event_type:
                query = query.eq("event_type", str(event_type).lower())
            if normalized_code:
                query = query.eq("referral_code", normalized_code)
            if referrer_user_id:
                query = query.eq("referrer_user_id", referrer_user_id)
            if referred_user_id:
                query = query.eq("referred_user_id", referred_user_id)
            if status:
                query = query.eq("status", str(status).lower())
            result = query.execute()
            rows = result.data or []
            if rows:
                return [_normalize_referral_event_row(row, source="referral_events") for row in rows]
        except Exception:
            pass

        try:
            rows = (
                supabase.table("abuse_events").select("*").order("created_at", desc=True).limit(max(limit * 4, 200)).execute()
            ).data or []
        except Exception:
            return []

        filtered: list[dict[str, Any]] = []
        for row in rows:
            normalized = _normalize_referral_event_row(row, source="abuse_events")
            current_event_type = str(normalized.get("event_type") or "")
            if not current_event_type.startswith("referral_"):
                continue
            if event_type and current_event_type != str(event_type).lower():
                continue
            if normalized_code and str(normalized.get("referral_code") or "") != normalized_code:
                continue
            if referrer_user_id and str(normalized.get("referrer_user_id") or "") != str(referrer_user_id):
                continue
            if referred_user_id and str(normalized.get("referred_user_id") or "") != str(referred_user_id):
                continue
            if status and str(normalized.get("status") or "") != str(status).lower():
                continue
            filtered.append(normalized)
            if len(filtered) >= limit:
                break
        return filtered

    return await asyncio.to_thread(_query)


async def _apply_referral_credit_delta(
    user_id: str,
    *,
    add_download_credits: int,
    add_api_credits: int,
    actor_user_id: str | None,
    notes: str,
) -> dict[str, Any]:
    current = load_credit_grants(user_id)
    return grant_credit_grants(
        user_id,
        bonus_download_credits=int(current.get("bonus_download_credits") or 0) + max(0, int(add_download_credits or 0)),
        bonus_api_credits=int(current.get("bonus_api_credits") or 0) + max(0, int(add_api_credits or 0)),
        actor_user_id=actor_user_id,
        notes=notes,
    )


async def _generate_unique_referral_code() -> str:
    for _ in range(10):
        code = _build_referral_code()
        existing = await _fetch_referral_events(limit=1, event_type="referral_code_created", referral_code=code)
        if not existing:
            return code
    return _normalize_referral_code(secrets.token_urlsafe(12))[:REFERRAL_CODE_LENGTH]


async def _ensure_referral_code(user_id: str, email: str | None = None) -> dict[str, Any]:
    existing = await _fetch_referral_events(limit=1, event_type="referral_code_created", referrer_user_id=user_id, status="active")
    if existing and existing[0].get("source") == "referral_events":
        return existing[0]
    if existing and existing[0].get("source") == "abuse_events":
        row = existing[0]
        payload = dict(row.get("payload") or {})
        try:
            migrated = await asyncio.to_thread(
                _persist_referral_event_primary,
                event_type="referral_code_created",
                referral_code=str(row.get("referral_code") or ""),
                referrer_user_id=str(row.get("referrer_user_id") or user_id),
                referred_user_id=row.get("referred_user_id"),
                reward_download_credits=int(row.get("reward_download_credits") or 0),
                reward_api_credits=int(row.get("reward_api_credits") or 0),
                status=str(row.get("status") or "active"),
                detail=row.get("detail"),
                payload=payload,
            )
            if migrated:
                return migrated
        except Exception:
            return row
        return row

    code = await _generate_unique_referral_code()
    return await _insert_referral_event(
        event_type="referral_code_created",
        referral_code=code,
        referrer_user_id=user_id,
        referred_user_id=None,
        status="active",
        detail="Referral code issued.",
        payload={"referrer_email": email},
    )


async def get_referral_profile_for_user(user: dict[str, Any]) -> dict[str, Any]:
    user_id = str(user.get("id") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    code_row = await _ensure_referral_code(user_id, str(user.get("email") or "") or None)
    code = str(code_row.get("referral_code") or "")
    claims = await _fetch_referral_events(limit=200, event_type="referral_claim_accepted", referrer_user_id=user_id)
    claimed_by_user = await _fetch_referral_events(limit=1, event_type="referral_claim_accepted", referred_user_id=user_id)

    total_referred_download = 0
    total_referred_api = 0
    recent_claims: list[dict[str, Any]] = []
    for row in claims:
        payload = dict(row.get("payload") or {})
        total_referred_download += int(payload.get("referrer_reward_download_credits") or row.get("reward_download_credits") or 0)
        total_referred_api += int(payload.get("referrer_reward_api_credits") or row.get("reward_api_credits") or 0)
        if len(recent_claims) < 10:
            recent_claims.append(
                {
                    "referred_user_id": row.get("referred_user_id"),
                    "created_at": row.get("created_at"),
                    "reward_download_credits": int(payload.get("referrer_reward_download_credits") or 0),
                    "reward_api_credits": int(payload.get("referrer_reward_api_credits") or 0),
                    "status": row.get("status"),
                }
            )

    return {
        "referral_code": code,
        "reward_policy": _referral_reward_policy(),
        "stats": {
            "accepted_referrals": len(claims),
            "earned_download_credits": total_referred_download,
            "earned_api_credits": total_referred_api,
            "claimed_another_code": bool(claimed_by_user),
        },
        "recent_claims": recent_claims,
        "source": code_row.get("source") or "referral_events",
    }


async def get_referral_analytics(*, limit: int = 200) -> dict[str, Any]:
    rows = await _fetch_referral_events(limit=limit)
    event_counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    code_counts: dict[str, int] = {}
    accepted_claims = 0
    rewarded_download_credits = 0
    rewarded_api_credits = 0
    recent_claims: list[dict[str, Any]] = []

    for row in rows:
        current_event_type = str(row.get("event_type") or "unknown").lower()
        current_status = str(row.get("status") or "active").lower()
        referral_code = str(row.get("referral_code") or "")
        event_counts[current_event_type] = event_counts.get(current_event_type, 0) + 1
        status_counts[current_status] = status_counts.get(current_status, 0) + 1
        if referral_code:
            code_counts[referral_code] = code_counts.get(referral_code, 0) + 1
        if current_event_type == "referral_claim_accepted":
            accepted_claims += 1
            payload = dict(row.get("payload") or {})
            rewarded_download_credits += int(payload.get("referrer_reward_download_credits") or 0) + int(
                payload.get("referred_reward_download_credits") or 0
            )
            rewarded_api_credits += int(payload.get("referrer_reward_api_credits") or 0) + int(
                payload.get("referred_reward_api_credits") or 0
            )
            if len(recent_claims) < 12:
                recent_claims.append(
                    {
                        "referral_code": referral_code,
                        "referrer_user_id": row.get("referrer_user_id"),
                        "referred_user_id": row.get("referred_user_id"),
                        "created_at": row.get("created_at"),
                        "status": current_status,
                    }
                )

    top_codes = sorted(code_counts.items(), key=lambda item: (-item[1], item[0]))[:10]

    return {
        "events_total": len(rows),
        "accepted_claims": accepted_claims,
        "rewarded_download_credits": rewarded_download_credits,
        "rewarded_api_credits": rewarded_api_credits,
        "event_counts": event_counts,
        "status_counts": status_counts,
        "top_codes": [{"referral_code": code, "events_total": total} for code, total in top_codes],
        "recent_claims": recent_claims,
        "reward_policy": _referral_reward_policy(),
        "source": rows[0].get("source") if rows else "empty",
    }


@router.get("/me")
async def get_my_referral_profile(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return await get_referral_profile_for_user(user)


DISPOSABLE_DOMAINS: set[str] = {
    "temp-mail.org", "temp-mail.io", "tempmail.com", "10minutemail.com",
    "mailinator.com", "dispostable.com", "guerrillamail.com", "sharklasers.com",
    "yopmail.com", "getairmail.com", "burnermail.io", "generator.email",
    "maildrop.cc", "trashmail.com", "tempmailaddress.com", "owlymail.com",
    "fakeinbox.com", "mohmal.com", "tempr.email", "boun.cr", "mailnesia.com",
    "temp-mail.ru", "crazymailing.com", "yopmail.fr", "yopmail.net",
    "cool.fr.nf", "jetable.org", "discard.email", "spambox.us", "trashmail.de",
    "disposable.com", "tempmail.net", "quickemail.info", "superrito.com",
    "armyspy.com", "cuvox.de", "dayrep.com", "fleckens.hu", "gustr.com",
    "rhyta.com", "teleworm.us", "zillamail.com", "spamgourmet.com",
    "incognitomail.com", "throwawaymail.com", "mailtemp.net"
}

# Load any custom blocked domains from environment variables
_env_blocked = os.environ.get("REFERRAL_BLOCKED_DOMAINS", "")
if _env_blocked:
    for _domain in _env_blocked.split(","):
        _domain = _domain.strip().lower()
        if _domain:
            DISPOSABLE_DOMAINS.add(_domain)

REFERRAL_MAX_ACCOUNT_AGE_HOURS = max(1, int(os.environ.get("REFERRAL_MAX_ACCOUNT_AGE_HOURS", "48")))


def _is_disposable_email(email: str) -> bool:
    if not email or "@" not in email:
        return False
    domain = email.split("@")[-1].strip().lower()
    return domain in DISPOSABLE_DOMAINS


def _get_client_ip(request: Request) -> str:
    x_forwarded_for = request.headers.get("x-forwarded-for")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


@router.post("/claim")
async def claim_referral_code(
    payload: ReferralClaimPayload,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = str(user.get("id") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    normalized_code = _normalize_referral_code(payload.code)
    if not normalized_code:
        raise HTTPException(status_code=400, detail="Referral code is required.")

    email = str(user.get("email") or "").strip().lower()
    if not email or email == "anonymous":
        raise HTTPException(status_code=400, detail="A valid email address is required to claim a referral.")

    client_ip = _get_client_ip(request)

    # 1. Block disposable or temporary email domains
    if _is_disposable_email(email):
        await _insert_referral_event(
            event_type="referral_claim_blocked",
            referral_code=normalized_code,
            referrer_user_id=None,
            referred_user_id=user_id,
            status="blocked",
            detail=f"Disposable email domain blocked: {email}",
            payload={
                "client_ip": client_ip,
                "email": email,
                "block_reason": "disposable_email_domain",
            }
        )
        raise HTTPException(
            status_code=400,
            detail="Temporary or disposable email addresses are not eligible for referral rewards."
        )

    # 2. Block accounts older than the allowed acquisition age window (e.g., 48 hours)
    user_created_at_str = user.get("created_at")
    if user_created_at_str:
        user_created_at = _parse_iso_datetime(user_created_at_str)
        if user_created_at:
            now_utc = datetime.now(timezone.utc)
            age_hours = (now_utc - user_created_at).total_seconds() / 3600.0
            if age_hours > REFERRAL_MAX_ACCOUNT_AGE_HOURS:
                await _insert_referral_event(
                    event_type="referral_claim_blocked",
                    referral_code=normalized_code,
                    referrer_user_id=None,
                    referred_user_id=user_id,
                    status="blocked",
                    detail=f"Account age limit exceeded ({age_hours:.1f} hours > {REFERRAL_MAX_ACCOUNT_AGE_HOURS} hours)",
                    payload={
                        "client_ip": client_ip,
                        "email": email,
                        "user_created_at": user_created_at_str,
                        "age_hours": age_hours,
                        "block_reason": "account_age_limit_exceeded",
                    }
                )
                raise HTTPException(
                    status_code=400,
                    detail=f"Referral claims are restricted to new accounts within {REFERRAL_MAX_ACCOUNT_AGE_HOURS} hours of registration."
                )

    # 3. Prevent self-referrals and double claims
    existing_claim = await _fetch_referral_events(limit=1, event_type="referral_claim_accepted", referred_user_id=user_id)
    if existing_claim:
        raise HTTPException(status_code=400, detail="This account has already claimed a referral code.")

    code_rows = await _fetch_referral_events(
        limit=1,
        event_type="referral_code_created",
        referral_code=normalized_code,
        status="active",
    )
    if not code_rows:
        raise HTTPException(status_code=404, detail="Referral code not found.")

    code_row = code_rows[0]
    referrer_user_id = str(code_row.get("referrer_user_id") or "")
    if not referrer_user_id:
        raise HTTPException(status_code=400, detail="Referral code is invalid.")
    if referrer_user_id == user_id:
        raise HTTPException(status_code=400, detail="You cannot claim your own referral code.")

    # 4. Fingerprint & IP Check (prevent multiple claims from the same IP)
    redis_client = None
    try:
        from backend.api_v1.middleware import _get_redis_client
        redis_client = _get_redis_client()
    except Exception:
        pass

    # A. Fast Redis lookup
    if redis_client:
        try:
            ip_key = f"referral_claim_ip:{client_ip}"
            exists = await redis_client.get(ip_key)
            if exists:
                await _insert_referral_event(
                    event_type="referral_claim_blocked",
                    referral_code=normalized_code,
                    referrer_user_id=referrer_user_id,
                    referred_user_id=user_id,
                    status="blocked",
                    detail=f"IP duplicate claim blocked (Redis cache hit): {client_ip}",
                    payload={
                        "client_ip": client_ip,
                        "email": email,
                        "block_reason": "ip_duplicate_rate_limit",
                    }
                )
                raise HTTPException(status_code=400, detail="Only one referral claim is allowed per IP address.")
        except HTTPException:
            raise
        except Exception:
            pass

    # B. Durable DB check (fallback or double-guard)
    ip_duplicate = False
    if supabase:
        try:
            res = supabase.table("referral_events").select("id").eq("event_type", "referral_claim_accepted").eq("payload->>client_ip", client_ip).execute()
            if res.data:
                ip_duplicate = True
        except Exception:
            # Python-based scanning fallback if JSON query operator fails
            try:
                claims = await _fetch_referral_events(limit=200, event_type="referral_claim_accepted")
                for c in claims:
                    if c.get("payload", {}).get("client_ip") == client_ip:
                        ip_duplicate = True
                        break
            except Exception:
                pass

    if ip_duplicate:
        await _insert_referral_event(
            event_type="referral_claim_blocked",
            referral_code=normalized_code,
            referrer_user_id=referrer_user_id,
            referred_user_id=user_id,
            status="blocked",
            detail=f"IP duplicate claim blocked: {client_ip}",
            payload={
                "client_ip": client_ip,
                "email": email,
                "block_reason": "ip_duplicate_database",
            }
        )
        raise HTTPException(status_code=400, detail="Only one referral claim is allowed per IP address.")

    # 5. Apply the Double-Sided rewards and log the accepted claim event
    policy = _referral_reward_policy()
    referrer_grants = await _apply_referral_credit_delta(
        referrer_user_id,
        add_download_credits=policy["referrer_download_credits"],
        add_api_credits=policy["referrer_api_credits"],
        actor_user_id=user_id,
        notes=f"Referral reward from code {normalized_code}",
    )
    referred_grants = await _apply_referral_credit_delta(
        user_id,
        add_download_credits=policy["referred_download_credits"],
        add_api_credits=policy["referred_api_credits"],
        actor_user_id=referrer_user_id,
        notes=f"Referral claim reward from code {normalized_code}",
    )

    event = await _insert_referral_event(
        event_type="referral_claim_accepted",
        referral_code=normalized_code,
        referrer_user_id=referrer_user_id,
        referred_user_id=user_id,
        reward_download_credits=policy["referrer_download_credits"] + policy["referred_download_credits"],
        reward_api_credits=policy["referrer_api_credits"] + policy["referred_api_credits"],
        status="accepted",
        detail="Referral claim accepted.",
        payload={
            "client_ip": client_ip,
            "referrer_reward_download_credits": policy["referrer_download_credits"],
            "referrer_reward_api_credits": policy["referrer_api_credits"],
            "referred_reward_download_credits": policy["referred_download_credits"],
            "referred_reward_api_credits": policy["referred_api_credits"],
            "referrer_bonus_download_total": int(referrer_grants.get("bonus_download_credits") or 0),
            "referrer_bonus_api_total": int(referrer_grants.get("bonus_api_credits") or 0),
            "referred_bonus_download_total": int(referred_grants.get("bonus_download_credits") or 0),
            "referred_bonus_api_total": int(referred_grants.get("bonus_api_credits") or 0),
        },
    )

    # Cache successful IP claim in Redis to prevent rapid farming re-tries
    if redis_client:
        try:
            ip_key = f"referral_claim_ip:{client_ip}"
            await redis_client.set(ip_key, "1", ex=31536000)  # cache for 1 year
        except Exception:
            pass

    return {
        "status": "accepted",
        "event": event,
        "reward_policy": policy,
        "credit_grants": {
            "referrer": referrer_grants,
            "referred": referred_grants,
        },
    }
