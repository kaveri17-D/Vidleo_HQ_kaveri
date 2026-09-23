import asyncio
import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

try:
    import razorpay
except Exception:  # pragma: no cover - optional until dependency is installed
    razorpay = None

try:
    from paddle_billing import Client as PaddleClient, Environment, Options
    from paddle_billing.Notifications import Secret, Verifier
except Exception:  # pragma: no cover - optional until dependency is installed
    PaddleClient = None
    Environment = None
    Options = None
    Secret = None
    Verifier = None

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.auth import get_current_user, supabase
from backend.pricing_runtime import (
    MIN_ELITE_THRESHOLD,
    get_pricing_snapshot,
    pricing_preview_charge_inr,
    pricing_preview_charge_usd_cents,
)
from backend.paddle_manager import (
    build_customer_portal_return_url,
    get_paddle_price_id_from_env,
    get_plan_definition,
    PADDLE_PLAN_CATALOG,
)

log = logging.getLogger("nexus.payments")

router = APIRouter(prefix="/api/payments", tags=["payments"])

SUPPORTED_PLANS = {
    "pro": 29900,
    "premium": 89900,
    "api": 149900,
    "api_growth": 499900,
}
PADDLE_FALLBACK_PRICE_CENTS = {
    "pro": 999,
    "premium": 2499,
    "api": 9999,
    "api_growth": 19999,
}
ACTIVE_SUBSCRIPTION_STATUSES = {"active", "trialing"}
ORDER_REUSE_WINDOW_MINUTES = 30
RAZORPAY_SUBSCRIPTION_PERIOD_DAYS = 30
PAID_EXTRACTION_PLAN_RANKS = {
    "pro": 1,
    "premium": 2,
    "api": 1,
    "api_growth": 2,
    "enterprise": 2,
}
ELITE_PLAN_ALIASES = {"elite", "elite_monthly", "premium"}


class CreateOrderPayload(BaseModel):
    plan: str = "pro"


class CreateCheckoutSessionPayload(BaseModel):
    plan: str = "pro"


class PaddleAccessRequestPayload(BaseModel):
    # Canonical field (spec: {"plan_code": str})
    plan_code: str | None = None
    # Legacy alias used by old frontend code
    plan_name: str | None = None
    country_code: str | None = None

    @property
    def resolved_plan(self) -> str:
        # plan_code takes precedence; fall back to plan_name; default to "pro"
        return (self.plan_code or self.plan_name or "pro").strip().lower()

    @property
    def normalized_country_code(self) -> str:
        country = str(self.country_code or "").strip().upper()
        return country[:2] if country else "US"


def get_razorpay_client():
    if razorpay is None:
        raise HTTPException(
            status_code=503,
            detail="Razorpay SDK is not installed on this backend.",
        )

    key_id = os.environ.get("RAZORPAY_KEY_ID")
    key_secret = os.environ.get("RAZORPAY_KEY_SECRET")

    if not key_id or not key_secret:
        raise HTTPException(
            status_code=503,
            detail="Payment gateway is not configured. Please contact support.",
        )

    return razorpay.Client(auth=(key_id, key_secret))


def get_paddle_client():
    if PaddleClient is None:
        raise HTTPException(
            status_code=503,
            detail="Paddle SDK is not installed on this backend.",
        )

    api_key = os.environ.get("PADDLE_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Paddle billing is not configured on this backend.",
        )

    return PaddleClient(api_key, options=Options(environment=Environment.PRODUCTION))


def is_paddle_enabled() -> bool:
    return os.environ.get("PADDLE_ENABLED", "false").strip().lower() == "true"


def is_paddle_configured() -> bool:
    return PaddleClient is not None and bool(os.environ.get("PADDLE_API_KEY"))


def build_receipt(user_id: str, plan: str) -> str:
    compact_user = str(user_id).replace("-", "")[:12]
    suffix = secrets.token_hex(4)
    receipt = f"nx_{plan}_{compact_user}_{suffix}"
    return receipt[:40]


def parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def epoch_to_iso(value: Any) -> str | None:
    if value in (None, ""):
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).isoformat()
    except Exception:
        return None


def get_web_base_url() -> str:
    return (
        os.environ.get("NEXUS_WEB_URL")
        or os.environ.get("NEXT_PUBLIC_APP_URL")
        or "http://localhost:3000"
    ).rstrip("/")


def normalize_checkout_plan(plan: str) -> str:
    normalized = str(plan or "").strip().lower()
    if normalized in ELITE_PLAN_ALIASES:
        return "premium"
    return normalized


def get_paid_extraction_rank(plan: str | None) -> int:
    normalized = str(plan or "").strip().lower()
    return PAID_EXTRACTION_PLAN_RANKS.get(normalized, 0)


def subscription_satisfies_required_plan(subscription: dict[str, Any] | None, required_plan: str) -> bool:
    if not subscription:
        return False
    status = str(subscription.get("status") or "").strip().lower()
    if status not in ACTIVE_SUBSCRIPTION_STATUSES:
        return False
    actual_rank = get_paid_extraction_rank(subscription.get("plan_code"))
    required_rank = get_paid_extraction_rank(required_plan)
    return actual_rank >= required_rank and required_rank > 0


def get_active_paid_subscription(user_id: str | None) -> dict[str, Any] | None:
    if not user_id:
        return None
    subscription = _load_subscription_for_user(str(user_id))
    if not subscription:
        return None
    if str(subscription.get("status") or "").strip().lower() not in ACTIVE_SUBSCRIPTION_STATUSES:
        return None
    if get_paid_extraction_rank(subscription.get("plan_code")) <= 0:
        return None
    return subscription


def get_reusable_order(user_id: str) -> Optional[dict[str, Any]]:
    try:
        response = (
            supabase.table("profiles")
            .select("current_order_id, order_created_at, current_order_plan")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        data = response.data or {}
        order_id = data.get("current_order_id")
        created_at = parse_iso_datetime(data.get("order_created_at"))
        current_plan = data.get("current_order_plan") or "pro"

        if not order_id or not created_at:
            return None

        if datetime.now(timezone.utc) - created_at > timedelta(minutes=ORDER_REUSE_WINDOW_MINUTES):
            return None

        amount = SUPPORTED_PLANS.get(current_plan)
        if not amount:
            return None

        return {
            "id": order_id,
            "amount": amount,
            "currency": "INR",
            "status": "created",
            "plan": current_plan,
            "provider": "razorpay",
        }
    except Exception as exc:
        log.warning("Failed to inspect reusable order for user %s: %s", user_id, exc)
        return None


def persist_order_lock(user_id: str, order: dict[str, Any]) -> None:
    try:
        payload = {
            "current_order_id": order["id"],
            "order_created_at": datetime.now(timezone.utc).isoformat(),
            "current_order_plan": (order.get("notes") or {}).get("plan"),
        }
        response = supabase.table("profiles").update(payload).eq("id", user_id).execute()
        if getattr(response, "error", None):
            payload.pop("current_order_plan", None)
            supabase.table("profiles").update(payload).eq("id", user_id).execute()
    except Exception as exc:
        log.warning("Failed to persist order lock for user %s: %s", user_id, exc)


def clear_order_lock(user_id: str) -> None:
    payload = {
        "current_order_id": None,
        "order_created_at": None,
        "current_order_plan": None,
    }
    try:
        response = supabase.table("profiles").update(payload).eq("id", user_id).execute()
        if getattr(response, "error", None):
            payload.pop("current_order_plan", None)
            supabase.table("profiles").update(payload).eq("id", user_id).execute()
    except Exception as exc:
        log.warning("Failed to clear order lock for user %s: %s", user_id, exc)


def _update_profile_plan(user_id: str, plan: str) -> bool:
    payload = {
        "plan": plan,
        "current_order_id": None,
        "order_created_at": None,
        "current_order_plan": None,
    }
    try:
        response = supabase.table("profiles").update(payload).eq("id", user_id).execute()
        if getattr(response, "error", None):
            payload.pop("current_order_plan", None)
            supabase.table("profiles").update(payload).eq("id", user_id).execute()
        return True
    except Exception as exc:
        log.warning("Failed to update plan %s for user %s: %s", plan, user_id, exc)
        return False


def _apply_plan_from_subscription_status(user_id: str, plan: str, status: str | None) -> None:
    normalized_status = str(status or "").lower()
    effective_plan = plan if normalized_status in ACTIVE_SUBSCRIPTION_STATUSES else "free"
    _update_profile_plan(user_id, effective_plan)


def _record_payment_event(
    user_id: str | None,
    event_type: str,
    order_id: str | None,
    payload: dict[str, Any],
    *,
    provider: str,
) -> None:
    if user_id:
        try:
            supabase.table("payment_logs").insert(
                {
                    "user_id": user_id,
                    "event_type": event_type,
                    "razorpay_order_id": order_id,
                    "payload": payload,
                }
            ).execute()
        except Exception as exc:
            log.warning("Failed to write payment log for %s: %s", user_id, exc)

    try:
        supabase.table("payment_events").insert(
            {
                "user_id": user_id,
                "event_type": event_type,
                "provider": provider,
                "provider_order_id": order_id,
                "payload": payload,
            }
        ).execute()
    except Exception:
        pass


def _record_billing_incident(
    *,
    provider: str,
    incident_type: str,
    detail: str | None = None,
    event_type: str | None = None,
    provider_reference: str | None = None,
    status_code: int | None = None,
) -> None:
    if not supabase:
        return

    payload = {
        "provider": provider,
        "incident_type": incident_type,
        "event_type": event_type,
        "provider_reference": provider_reference,
        "detail": detail,
        "status_code": status_code,
    }

    try:
        supabase.table("billing_incidents").insert(payload).execute()
    except Exception as exc:
        log.warning("Failed to record billing incident for provider %s: %s", provider, exc)


def _record_abuse_event(
    *,
    user_id: str | None,
    event_type: str,
    detail: str | None,
    payload: dict[str, Any],
) -> None:
    if not supabase:
        return

    try:
        supabase.table("abuse_events").insert(
            {
                "user_id": user_id,
                "event_type": event_type,
                "detail": detail,
                "payload": payload,
            }
        ).execute()
    except Exception as exc:
        log.warning("Failed to record abuse/webhook event %s: %s", event_type, exc)


def _sync_subscription_state(
    user_id: str,
    plan: str,
    *,
    provider: str,
    provider_subscription_id: str | None = None,
    status: str = "active",
    current_period_end: str | None = None,
    cancel_at_period_end: bool = False,
    ) -> bool:
    payload = {
        "user_id": user_id,
        "provider": provider,
        "provider_subscription_id": provider_subscription_id,
        "status": status,
        "plan_code": plan,
        "current_period_end": current_period_end,
        "cancel_at_period_end": cancel_at_period_end,
    }
    try:
        existing = supabase.table("subscriptions").select("id").eq("user_id", user_id).maybe_single().execute()
        if existing.data:
            supabase.table("subscriptions").update(payload).eq("user_id", user_id).execute()
        else:
            supabase.table("subscriptions").insert(payload).execute()
        return True
    except Exception:
        return False


def _subscription_matches_plan(
    subscription: dict[str, Any] | None,
    *,
    expected_plan: str,
    expected_provider: str,
    expected_provider_subscription_id: str | None = None,
) -> bool:
    if not subscription:
        return False

    subscription_status = str(subscription.get("status") or "").strip().lower()
    if subscription_status not in ACTIVE_SUBSCRIPTION_STATUSES:
        return False

    plan_code = str(subscription.get("plan_code") or "").strip().lower()
    provider = str(subscription.get("provider") or "").strip().lower()
    if plan_code != str(expected_plan).strip().lower() or provider != str(expected_provider).strip().lower():
        return False

    if expected_provider_subscription_id:
        provider_subscription_id = str(subscription.get("provider_subscription_id") or "").strip()
        if provider_subscription_id != str(expected_provider_subscription_id).strip():
            return False

    return True


def _load_subscription_owner(provider_subscription_id: str | None) -> tuple[str | None, str | None]:
    if not provider_subscription_id:
        return None, None

    try:
        result = (
            supabase.table("subscriptions")
            .select("user_id, plan_code")
            .eq("provider_subscription_id", provider_subscription_id)
            .maybe_single()
            .execute()
        )
        data = result.data or {}
        return data.get("user_id"), data.get("plan_code")
    except Exception:
        return None, None


def _load_subscription_for_user(user_id: str) -> dict[str, Any] | None:
    try:
        result = (
            supabase.table("subscriptions")
            .select("*")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        return result.data or None
    except Exception:
        return None


def _resolve_razorpay_verified_plan(user_id: str, razorpay_order_id: str | None) -> str:
    try:
        profile = (
            supabase.table("profiles")
            .select("current_order_plan")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        current_order_plan = str((profile.data or {}).get("current_order_plan") or "").strip().lower()
        if current_order_plan in SUPPORTED_PLANS:
            return current_order_plan
    except Exception:
        pass

    pending_user_id, pending_plan = _load_pending_razorpay_order_owner(str(razorpay_order_id or ""))
    if pending_user_id and str(pending_user_id) == str(user_id) and pending_plan in SUPPORTED_PLANS:
        return str(pending_plan)

    existing_subscription = _load_subscription_for_user(user_id) or {}
    existing_plan = str(existing_subscription.get("plan_code") or "").strip().lower()
    existing_status = str(existing_subscription.get("status") or "").strip().lower()
    if existing_plan in SUPPORTED_PLANS and existing_status in ACTIVE_SUBSCRIPTION_STATUSES:
        return existing_plan

    return "pro"


def _load_payment_events_for_order(order_id: str, limit: int = 20) -> list[dict[str, Any]]:
    if not supabase or not order_id:
        return []
    try:
        result = (
            supabase.table("payment_events")
            .select("*")
            .eq("provider", "razorpay")
            .eq("provider_order_id", order_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        log.warning("Failed to load payment events for Razorpay order %s: %s", order_id, exc)
        return []


def _load_pending_razorpay_order_owner(order_id: str) -> tuple[str | None, str | None]:
    for row in _load_payment_events_for_order(order_id):
        event_type = str(row.get("event_type") or "").lower()
        payload = row.get("payload") or {}
        if event_type not in {"order_created", "order_reused", "created"}:
            continue
        user_id = row.get("user_id") or ((payload.get("notes") or {}).get("userId"))
        plan = (
            str(((payload.get("notes") or {}).get("plan")) or payload.get("plan") or "").strip().lower() or None
        )
        if user_id:
            return str(user_id), plan
    return None, None


def _has_processed_razorpay_payment(payment_id: str) -> bool:
    if not supabase or not payment_id:
        return False
    try:
        result = (
            supabase.table("subscriptions")
            .select("id")
            .eq("provider", "razorpay")
            .eq("provider_subscription_id", payment_id)
            .limit(1)
            .execute()
        )
        return bool(result.data)
    except Exception as exc:
        log.warning("Failed to inspect existing Razorpay payment %s: %s", payment_id, exc)
        return False


def _extract_plan_from_paddle_event(event_data: dict[str, Any], default: str = "pro") -> str:
    """Extract the NEXUS plan code from a Paddle webhook event payload."""
    # Check custom_data first (set when creating the transaction)
    custom_data = event_data.get("custom_data") or {}
    if custom_data.get("plan"):
        return str(custom_data["plan"]).lower()

    # Check items in the transaction/subscription
    items = event_data.get("items") or []
    if items:
        price_id = (items[0].get("price") or {}).get("id")
        mapped = _get_plan_from_paddle_price_id(price_id)
        if mapped:
            return mapped

    return default


def _get_plan_from_paddle_price_id(price_id: str | None) -> str | None:
    if not price_id:
        return None
    from backend.paddle_manager import PADDLE_PLAN_CATALOG
    for plan_code, definition in PADDLE_PLAN_CATALOG.items():
        if definition.env_price_id:
            env_price = os.environ.get(definition.env_price_id)
            if env_price and env_price == price_id:
                return plan_code
    return None


def _extract_user_id_from_paddle_event(event_data: dict[str, Any]) -> str | None:
    custom_data = event_data.get("custom_data") or {}
    user_id = custom_data.get("user_id") or custom_data.get("userId")
    if user_id:
        return str(user_id)

    subscription_id = event_data.get("id")
    loaded_user_id, _ = _load_subscription_owner(str(subscription_id) if subscription_id else None)
    return loaded_user_id


def reconcile_subscription_row(subscription_row: dict[str, Any]) -> dict[str, Any]:
    provider = str(subscription_row.get("provider") or "unknown").lower()
    user_id = str(subscription_row.get("user_id") or "")
    plan = str(subscription_row.get("plan_code") or "free").lower()

    if not user_id:
        return {
            "provider": provider,
            "user_id": None,
            "status": "skipped",
            "reason": "missing_user_id",
        }

    if provider == "paddle":
        if not is_paddle_configured():
            return {
                "provider": provider,
                "user_id": user_id,
                "status": "skipped",
                "reason": "paddle_not_configured",
            }

        provider_subscription_id = subscription_row.get("provider_subscription_id")
        if not provider_subscription_id:
            return {
                "provider": provider,
                "user_id": user_id,
                "status": "skipped",
                "reason": "missing_provider_subscription_id",
            }

        # For Paddle, we trust webhook-driven updates as source of truth
        # We do a best-effort status check via the stored row
        remote_status = str(subscription_row.get("status") or "active").lower()
        current_period_end = subscription_row.get("current_period_end")
        cancel_at_period_end = bool(subscription_row.get("cancel_at_period_end"))

        _sync_subscription_state(
            user_id,
            plan,
            provider="paddle",
            provider_subscription_id=str(provider_subscription_id),
            status=remote_status,
            current_period_end=current_period_end,
            cancel_at_period_end=cancel_at_period_end,
        )
        _apply_plan_from_subscription_status(user_id, plan, remote_status)

        return {
            "provider": provider,
            "user_id": user_id,
            "status": "reconciled",
            "subscription_status": remote_status,
            "plan_code": plan,
            "provider_subscription_id": provider_subscription_id,
        }

    if provider == "razorpay":
        return {
            "provider": provider,
            "user_id": user_id,
            "status": "skipped",
            "reason": "provider_not_reconcilable",
        }

    return {
        "provider": provider,
        "user_id": user_id,
        "status": "skipped",
        "reason": "unsupported_provider",
    }


async def reconcile_subscriptions_best_effort(limit: int = 500) -> dict[str, Any]:
    if not supabase:
        return {
            "status": "skipped",
            "reason": "supabase_not_configured",
            "source_rows": 0,
            "reconciled_rows": 0,
            "skipped_rows": 0,
            "provider_counts": {},
            "status_counts": {},
            "recent_results": [],
        }

    def _fetch_rows():
        try:
            result = (
                supabase.table("subscriptions")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    rows = await asyncio.to_thread(_fetch_rows)
    provider_counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    recent_results: list[dict[str, Any]] = []
    reconciled_rows = 0
    skipped_rows = 0

    for row in rows:
        result = reconcile_subscription_row(row)
        provider = str(result.get("provider") or "unknown").lower()
        provider_counts[provider] = provider_counts.get(provider, 0) + 1
        result_status = str(result.get("status") or "unknown").lower()
        status_counts[result_status] = status_counts.get(result_status, 0) + 1
        if result_status == "reconciled":
            reconciled_rows += 1
        else:
            skipped_rows += 1
        if len(recent_results) < 25:
            recent_results.append(result)

    return {
        "status": "ok",
        "source_rows": len(rows),
        "reconciled_rows": reconciled_rows,
        "skipped_rows": skipped_rows,
        "provider_counts": provider_counts,
        "status_counts": status_counts,
        "recent_results": recent_results,
        "paddle_configured": is_paddle_configured(),
    }


@router.post("/create-order")
@router.post("/razorpay/create-order")
async def create_order(payload: CreateOrderPayload, request: Request, user: dict = Depends(get_current_user)):
    if user.get("anonymous"):
        raise HTTPException(status_code=401, detail="Please sign in to continue with payment.")

    plan = normalize_checkout_plan(payload.plan)
    pricing_snapshot = await get_pricing_snapshot()
    if plan == "premium":
        amount = pricing_preview_charge_inr(pricing_snapshot) * 100
    else:
        amount = SUPPORTED_PLANS.get(plan)
    if not amount:
        raise HTTPException(status_code=400, detail="Unsupported upgrade plan.")

    reusable = get_reusable_order(user["id"])
    if reusable and reusable.get("plan") == plan and int(reusable.get("amount") or 0) == int(amount):
        log.info("Reusing fresh order %s for user %s", reusable["id"], user["id"])
        _record_payment_event(
            str(user["id"]),
            "order_reused",
            reusable.get("id"),
            {
                "amount": reusable.get("amount"),
                "currency": reusable.get("currency"),
                "status": reusable.get("status"),
                "plan": plan,
                "notes": {"userId": user["id"], "plan": plan, "email": user.get("email", "")},
            },
            provider="razorpay",
        )
        return reusable
    if reusable and reusable.get("plan") == plan and int(reusable.get("amount") or 0) != int(amount):
        clear_order_lock(user["id"])

    client = get_razorpay_client()
    receipt = build_receipt(user["id"], plan)
    order_payload = {
        "amount": amount,
        "currency": "INR",
        "receipt": receipt,
        "notes": {
            "userId": user["id"],
            "plan": plan,
            "email": user.get("email", ""),
            "source": "nexus-web",
            "pricing_lane": "elite_monthly" if plan == "premium" else "static_catalog",
        },
    }

    try:
        order = client.order.create(data=order_payload)
        persist_order_lock(user["id"], order)
        _record_payment_event(
            str(user["id"]),
            "order_created",
            order.get("id"),
            {
                "amount": order.get("amount"),
                "currency": order.get("currency"),
                "status": order.get("status", "created"),
                "plan": plan,
                "notes": order_payload.get("notes") or {},
                "receipt": receipt,
            },
            provider="razorpay",
        )
        return {
            "id": order["id"],
            "amount": order["amount"],
            "currency": order["currency"],
            "status": order.get("status", "created"),
            "plan": plan,
            "provider": "razorpay",
        }
    except Exception as exc:
        client_host = request.client.host if request.client else "unknown"
        log.exception("Razorpay order creation failed for user %s from %s: %s", user["id"], client_host, exc)
        raise HTTPException(status_code=502, detail="Financial gateway communication failed.")


@router.post("/create-checkout-session")
async def create_checkout_session(payload: CreateCheckoutSessionPayload, user: dict = Depends(get_current_user)):
    """
    Create a Paddle checkout session for international (non-India) users.
    Returns the Paddle checkout transaction ID for client-side Paddle.js to open.
    """
    if user.get("anonymous"):
        raise HTTPException(status_code=401, detail="Please sign in to continue with payment.")

    if not is_paddle_enabled():
        raise HTTPException(status_code=503, detail="Paddle checkout is not enabled yet.")

    plan = normalize_checkout_plan(payload.plan)
    if plan not in SUPPORTED_PLANS:
        raise HTTPException(status_code=400, detail="Unsupported upgrade plan.")

    price_id = get_paddle_price_id_from_env(plan)
    if not price_id:
        raise HTTPException(
            status_code=503,
            detail=f"Paddle price ID not configured for plan '{plan}'. Please contact support.",
        )

    base_url = get_web_base_url()

    try:
        pricing_snapshot = await get_pricing_snapshot()

        # Build custom data to tag the transaction with user and plan info
        custom_data = {
            "user_id": str(user["id"]),
            "plan": plan,
            "provider": "paddle",
            "source": "nexus-web",
        }

        # Return price_id and custom_data for the frontend Paddle.js overlay checkout
        return {
            "price_id": price_id,
            "custom_data": custom_data,
            "provider": "paddle",
            "plan": plan,
            "success_url": f"{base_url}/dashboard?billing=success&provider=paddle&plan={plan}",
            "cancel_url": f"{base_url}/pricing?billing=cancelled&provider=paddle&plan={plan}",
        }
    except Exception as exc:
        log.exception("Paddle checkout session creation failed for user %s: %s", user["id"], exc)
        raise HTTPException(status_code=502, detail="Paddle checkout session failed.")


@router.post("/request-paddle-access")
@router.post("/paddle-waitlist")
@router.post("/international/interest")
async def request_paddle_access(payload: PaddleAccessRequestPayload, user: dict = Depends(get_current_user)):
    if user.get("anonymous"):
        raise HTTPException(status_code=401, detail="Please sign in to request Paddle access.")

    requested_plan = payload.resolved_plan
    if requested_plan not in {*SUPPORTED_PLANS.keys(), "enterprise"}:
        raise HTTPException(status_code=400, detail="Unsupported Paddle access request plan.")

    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase is not configured.")

    now_iso = datetime.now(timezone.utc).isoformat()
    waitlist_row = {
        "user_id": user["id"],
        "email": str(user.get("email") or "").strip(),
        "desired_plan": requested_plan,
        "country_code": payload.normalized_country_code,
        "status": "pending",
        "source": "nexus-web",
        "updated_at": now_iso,
    }
    legacy_request_row = {
        "user_id": user["id"],
        "requested_plan": requested_plan,
        "status": "pending",
        "updated_at": now_iso,
    }

    def _upsert_waitlist():
        return (
            supabase
            .table("stripe_waitlist")  # keep same table for backwards compat
            .upsert(waitlist_row, on_conflict="user_id,desired_plan")
            .execute()
        )

    def _upsert_legacy_request():
        return (
            supabase
            .table("stripe_access_requests")  # keep same table for backwards compat
            .upsert(legacy_request_row, on_conflict="user_id,requested_plan")
            .execute()
        )

    try:
        await asyncio.to_thread(_upsert_waitlist)
    except Exception as exc:
        log.warning("Failed to record Paddle waitlist request for user %s: %s", user["id"], exc)

    try:
        await asyncio.to_thread(_upsert_legacy_request)
    except Exception:
        pass

    try:
        plan_definition = get_plan_definition(requested_plan)
        marketing_name = plan_definition.marketing_name
    except KeyError:
        marketing_name = requested_plan.upper()

    return {
        "status": "logged",
        "requested_plan": requested_plan,
        "marketing_name": marketing_name,
        "country_code": payload.normalized_country_code,
        "paddle_enabled": is_paddle_enabled(),
    }


@router.get("/subscription-status")
async def subscription_status(user: dict = Depends(get_current_user)):
    if user.get("anonymous"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    subscription = _load_subscription_for_user(str(user["id"]))
    return {
        "plan": user.get("plan") or "free",
        "subscription": subscription,
    }


@router.post("/create-billing-portal-session")
async def create_billing_portal_session(user: dict = Depends(get_current_user)):
    if user.get("anonymous"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    subscription = _load_subscription_for_user(str(user["id"]))
    if not subscription:
        raise HTTPException(status_code=404, detail="No subscription found for this account.")

    provider = str(subscription.get("provider") or "").lower()

    if provider == "paddle":
        # Paddle customer portal — redirect to Paddle's hosted portal
        base_url = get_web_base_url()
        portal_url = f"https://customer.paddle.com"
        return {
            "provider": "paddle",
            "url": portal_url,
        }

    raise HTTPException(
        status_code=400,
        detail="Self-serve billing portal is only available for Paddle subscriptions.",
    )


@router.post("/verify-payment")
async def verify_payment(payload: dict, user: dict = Depends(get_current_user)):
    if user.get("anonymous"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    razorpay_order_id = payload.get("razorpay_order_id")
    razorpay_payment_id = payload.get("razorpay_payment_id")
    razorpay_signature = payload.get("razorpay_signature")

    if not all([razorpay_order_id, razorpay_payment_id, razorpay_signature]):
        raise HTTPException(status_code=400, detail="Incomplete payment metadata.")

    client = get_razorpay_client()

    try:
        client.utility.verify_payment_signature(
            {
                "razorpay_order_id": razorpay_order_id,
                "razorpay_payment_id": razorpay_payment_id,
                "razorpay_signature": razorpay_signature,
            }
        )
    except Exception as exc:
        log.error("Payment signature verification failed for user %s: %s", user["id"], exc)
        raise HTTPException(status_code=400, detail="Invalid payment signature.")

    plan = _resolve_razorpay_verified_plan(str(user["id"]), razorpay_order_id)
    current_period_end = (datetime.now(timezone.utc) + timedelta(days=RAZORPAY_SUBSCRIPTION_PERIOD_DAYS)).isoformat()

    profile_updated = _update_profile_plan(user["id"], plan)
    _record_payment_event(user["id"], "verified_frontend", razorpay_order_id, payload, provider="razorpay")
    subscription_updated = _sync_subscription_state(
        user["id"],
        plan,
        provider="razorpay",
        provider_subscription_id=razorpay_payment_id,
        status="active",
        current_period_end=current_period_end,
    )
    clear_order_lock(str(user["id"]))
    subscription = _load_subscription_for_user(str(user["id"]))

    if not profile_updated or not subscription_updated or not _subscription_matches_plan(
        subscription,
        expected_plan=plan,
        expected_provider="razorpay",
        expected_provider_subscription_id=razorpay_payment_id,
    ):
        _record_billing_incident(
            provider="razorpay",
            incident_type="activation_sync_incomplete",
            detail="Frontend payment verification succeeded but activation state was not fully persisted.",
            event_type="verify_payment",
            provider_reference=razorpay_payment_id,
            status_code=502,
        )
        raise HTTPException(
            status_code=502,
            detail="Payment captured, but activation sync is still settling. Please wait a moment and refresh.",
        )

    return {
        "status": "success",
        "message": f"NEXUS {plan.upper()} Activated.",
        "plan": plan,
        "subscription": subscription,
    }


@router.post("/webhook")
async def razorpay_webhook(request: Request):
    data = await request.body()
    signature = request.headers.get("X-Razorpay-Signature")
    secret = os.getenv("RAZORPAY_WEBHOOK_SECRET")

    if not signature or not secret:
        _record_payment_event(
            None,
            "webhook_rejected_missing_signature",
            None,
            {
                "headers": {"x-razorpay-signature": bool(signature)},
                "reason": "missing_signature_or_secret",
            },
            provider="razorpay",
        )
        _record_billing_incident(
            provider="razorpay",
            incident_type="missing_signature_or_secret",
            detail="Missing Razorpay webhook signature or secret.",
            status_code=400,
        )
        raise HTTPException(status_code=400, detail="Missing signature or secret.")

    client = get_razorpay_client()

    try:
        client.utility.verify_webhook_signature(data.decode(), signature, secret)
    except Exception:
        log.warning("Invalid webhook signature intercepted.")
        _record_payment_event(
            None,
            "webhook_rejected_invalid_signature",
            None,
            {
                "headers": {"x-razorpay-signature": True},
                "reason": "invalid_signature",
            },
            provider="razorpay",
        )
        _record_billing_incident(
            provider="razorpay",
            incident_type="invalid_signature",
            detail="Invalid Razorpay webhook signature.",
            status_code=400,
        )
        raise HTTPException(status_code=400, detail="Signature mismatch.")

    payload = await request.json()
    event_type = str(payload.get("event") or "").lower()
    payment_entity = (((payload.get("payload") or {}).get("payment") or {}).get("entity") or {})
    order_entity = (((payload.get("payload") or {}).get("order") or {}).get("entity") or {})
    notes = payment_entity.get("notes") or order_entity.get("notes") or {}
    order_id = str(payment_entity.get("order_id") or order_entity.get("id") or "")
    payment_id = str(payment_entity.get("id") or "")
    noted_user_id = notes.get("userId") or notes.get("user_id")
    noted_email = notes.get("email")
    provider_reference = payment_id or order_id or str(payload.get("contains") or "")

    _record_payment_event(
        str(noted_user_id) if noted_user_id else None,
        f"webhook_{event_type or 'unknown'}_received",
        order_id or provider_reference,
        payload,
        provider="razorpay",
    )
    _record_abuse_event(
        user_id=str(noted_user_id) if noted_user_id else None,
        event_type="razorpay_webhook_received",
        detail=event_type or "unknown",
        payload={
            "event": event_type,
            "order_id": order_id,
            "payment_id": payment_id,
            "email": noted_email,
        },
    )

    try:
        if event_type not in {"payment.captured", "order.paid"}:
            return {"status": "ignored", "event": event_type}

        if not order_id or not payment_id:
            _record_billing_incident(
                provider="razorpay",
                incident_type="webhook_missing_ids",
                detail="Razorpay webhook did not include order_id/payment_id.",
                event_type=event_type,
                provider_reference=provider_reference,
                status_code=200,
            )
            return {"status": "accepted_with_warning", "reason": "missing_ids"}

        pending_user_id, pending_plan = _load_pending_razorpay_order_owner(order_id)
        user_id = str(noted_user_id or pending_user_id or "").strip() or None
        plan = str(notes.get("plan") or pending_plan or "pro").lower()

        if _has_processed_razorpay_payment(payment_id):
            _record_billing_incident(
                provider="razorpay",
                incident_type="duplicate_payment_webhook",
                detail="Duplicate Razorpay webhook ignored after prior activation.",
                event_type=event_type,
                provider_reference=payment_id,
                status_code=200,
            )
            return {"status": "duplicate_ignored", "payment_id": payment_id}

        if not user_id:
            _record_billing_incident(
                provider="razorpay",
                incident_type="unmatched_pending_order",
                detail="No user could be resolved from notes or pending order ledger.",
                event_type=event_type,
                provider_reference=order_id,
                status_code=200,
            )
            return {"status": "accepted_with_warning", "reason": "missing_user_mapping"}

        if pending_user_id and str(pending_user_id) != str(user_id):
            _record_billing_incident(
                provider="razorpay",
                incident_type="user_mismatch",
                detail="Webhook notes and pending order ledger resolved different users.",
                event_type=event_type,
                provider_reference=order_id,
                status_code=200,
            )
            return {"status": "accepted_with_warning", "reason": "user_mismatch"}

        current_period_end = (datetime.now(timezone.utc) + timedelta(days=RAZORPAY_SUBSCRIPTION_PERIOD_DAYS)).isoformat()
        _update_profile_plan(user_id, plan)
        _record_payment_event(
            user_id,
            "captured",
            order_id,
            {
                "event": event_type,
                "payment_id": payment_id,
                "plan": plan,
                "email": noted_email,
                "notes": notes,
                "captured_at": datetime.now(timezone.utc).isoformat(),
            },
            provider="razorpay",
        )
        _sync_subscription_state(
            user_id,
            plan,
            provider="razorpay",
            provider_subscription_id=payment_id,
            status="active",
            current_period_end=current_period_end,
            cancel_at_period_end=False,
        )
        log.info("Webhook upgrade completed for user %s with plan %s from order %s", user_id, plan, order_id)
    except Exception as exc:
        log.exception("Razorpay webhook processing failed: %s", exc)
        _record_billing_incident(
            provider="razorpay",
            incident_type="processing_failure",
            detail=str(exc),
            event_type=event_type,
            provider_reference=provider_reference,
            status_code=200,
        )
        _record_abuse_event(
            user_id=str(noted_user_id) if noted_user_id else None,
            event_type="razorpay_webhook_processing_failure",
            detail=str(exc),
            payload={"event": event_type, "order_id": order_id, "payment_id": payment_id},
        )
        return {"status": "accepted_with_warning", "reason": "processing_failure"}

    return {"status": "ok", "event": event_type}


@router.post("/paddle-webhook")
async def paddle_webhook(request: Request):
    """
    Receives and processes Paddle webhook events.
    Paddle sends a `Paddle-Signature` header. We verify using the endpoint secret.
    """
    raw_body = await request.body()
    signature_header = request.headers.get("Paddle-Signature")
    webhook_secret = os.environ.get("PADDLE_WEBHOOK_SECRET")

    if not signature_header or not webhook_secret:
        _record_billing_incident(
            provider="paddle",
            incident_type="missing_signature_or_secret",
            detail="Missing Paddle webhook signature header or endpoint secret.",
            status_code=400,
        )
        raise HTTPException(status_code=400, detail="Missing Paddle signature or secret.")

    # Verify the Paddle webhook signature
    # Paddle uses: ts=<timestamp>;h1=<hmac_sha256>
    try:
        verified = _verify_paddle_signature(raw_body, signature_header, webhook_secret)
    except Exception as exc:
        log.warning("Paddle signature verification error: %s", exc)
        verified = False

    if not verified:
        log.warning("Invalid Paddle webhook signature intercepted.")
        _record_billing_incident(
            provider="paddle",
            incident_type="invalid_signature",
            detail="Invalid Paddle webhook signature.",
            status_code=400,
        )
        raise HTTPException(status_code=400, detail="Signature mismatch.")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload.")

    event_type = str(payload.get("event_type") or payload.get("type") or "")
    event_data = payload.get("data") or {}
    if hasattr(event_data, "to_dict"):
        event_data = event_data.to_dict()
    elif not isinstance(event_data, dict):
        event_data = dict(event_data)

    subscription_id = event_data.get("id") or event_data.get("subscription_id")
    user_id = _extract_user_id_from_paddle_event(event_data)

    _record_payment_event(
        user_id,
        f"paddle_{event_type or 'unknown'}_received",
        str(subscription_id or ""),
        payload,
        provider="paddle",
    )

    try:
        if event_type in {"subscription.created", "subscription.activated"}:
            plan = _extract_plan_from_paddle_event(event_data)
            status = str(event_data.get("status") or "active").lower()
            current_period_end = event_data.get("current_billing_period", {}).get("ends_at")
            cancel_at_period_end = bool(event_data.get("cancel_at_period_end", False))

            if user_id:
                _sync_subscription_state(
                    user_id,
                    plan,
                    provider="paddle",
                    provider_subscription_id=str(subscription_id),
                    status=status,
                    current_period_end=current_period_end,
                    cancel_at_period_end=cancel_at_period_end,
                )
                _apply_plan_from_subscription_status(user_id, plan, status)
                clear_order_lock(user_id)
            _record_payment_event(
                user_id, f"paddle_subscription_{event_type.split('.')[-1]}",
                str(subscription_id), event_data, provider="paddle",
            )

        elif event_type == "subscription.updated":
            plan = _extract_plan_from_paddle_event(event_data)
            status = str(event_data.get("status") or "active").lower()
            current_period_end = event_data.get("current_billing_period", {}).get("ends_at")
            cancel_at_period_end = bool(event_data.get("scheduled_change", {}).get("action") == "cancel")

            if user_id:
                _sync_subscription_state(
                    user_id,
                    plan,
                    provider="paddle",
                    provider_subscription_id=str(subscription_id),
                    status=status,
                    current_period_end=current_period_end,
                    cancel_at_period_end=cancel_at_period_end,
                )
                _apply_plan_from_subscription_status(user_id, plan, status)
            _record_payment_event(
                user_id, "paddle_subscription_updated", str(subscription_id), event_data, provider="paddle",
            )

        elif event_type == "subscription.canceled":
            plan = _extract_plan_from_paddle_event(event_data)
            if user_id:
                _sync_subscription_state(
                    user_id,
                    plan,
                    provider="paddle",
                    provider_subscription_id=str(subscription_id),
                    status="canceled",
                    cancel_at_period_end=False,
                )
                _apply_plan_from_subscription_status(user_id, plan, "canceled")
            _record_payment_event(
                user_id, "paddle_subscription_canceled", str(subscription_id), event_data, provider="paddle",
            )

        elif event_type == "transaction.completed":
            # For one-time or first payment of subscription
            plan = _extract_plan_from_paddle_event(event_data)
            sub_id = event_data.get("subscription_id") or subscription_id
            if user_id:
                _sync_subscription_state(
                    user_id,
                    plan,
                    provider="paddle",
                    provider_subscription_id=str(sub_id) if sub_id else None,
                    status="active",
                )
                _apply_plan_from_subscription_status(user_id, plan, "active")
                clear_order_lock(user_id)
            _record_payment_event(
                user_id, "paddle_transaction_completed", str(event_data.get("id") or ""), event_data, provider="paddle",
            )

        elif event_type == "transaction.payment_failed":
            plan = _extract_plan_from_paddle_event(event_data)
            sub_id = event_data.get("subscription_id") or subscription_id
            if user_id:
                _sync_subscription_state(
                    user_id,
                    plan,
                    provider="paddle",
                    provider_subscription_id=str(sub_id) if sub_id else None,
                    status="past_due",
                )
                _apply_plan_from_subscription_status(user_id, plan, "past_due")
            _record_payment_event(
                user_id, "paddle_payment_failed", str(event_data.get("id") or ""), event_data, provider="paddle",
            )
            _record_billing_incident(
                provider="paddle",
                incident_type="payment_failed",
                detail=f"Paddle payment failed for subscription {sub_id}",
                event_type=event_type,
                provider_reference=str(sub_id or ""),
                status_code=200,
            )

        else:
            log.info("Unhandled Paddle event type: %s", event_type)

    except Exception as exc:
        log.exception("Paddle webhook processing failed for event %s: %s", event_type, exc)
        _record_billing_incident(
            provider="paddle",
            incident_type="processing_failure",
            detail=str(exc),
            event_type=event_type,
            provider_reference=str(subscription_id or ""),
            status_code=500,
        )
        raise HTTPException(status_code=500, detail="Webhook processing failed.")

    return {"status": "ok"}


def _verify_paddle_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    """
    Verify Paddle webhook signature.
    Paddle-Signature: ts=<timestamp>;h1=<hmac_sha256>
    The signed payload is: <ts>:<raw_body>
    """
    try:
        parts = dict(part.split("=", 1) for part in signature_header.split(";"))
        ts = parts.get("ts", "")
        h1 = parts.get("h1", "")
        if not ts or not h1:
            return False
        signed_payload = f"{ts}:".encode("utf-8") + raw_body
        expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, h1)
    except Exception:
        return False
