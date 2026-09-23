from __future__ import annotations

import asyncio
import csv
import io
import json
import os
import secrets
import shutil
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from starlette.responses import Response, StreamingResponse

from backend.auth import get_current_user, grant_credit_grants, load_credit_grants, supabase
from backend.api_v1.middleware import (
    apply_api_key_override_to_entitlement,
    ensure_redis_or_fail,
    get_api_key_override,
    get_default_rate_limit_for_plan,
    get_redis_runtime_status,
    get_api_key_record_for_user,
    list_all_api_keys,
    revoke_api_key_for_user,
    rotate_api_key_record,
    summarize_api_key_usage,
    upsert_api_key_override,
    update_api_key_record,
)
from backend.celery_app import celery_app, celery_available
from backend.entitlements import KNOWN_PLANS, build_effective_entitlement, normalize_plan
from backend.job_runner import run_download_job_async
from backend.job_store import add_job_event, get_job, register_job, summarize_jobs, update_job
from backend.payments import is_paddle_configured, is_paddle_enabled, reconcile_subscriptions_best_effort
from backend.proxy_state import (
    clear_proxy_burn,
    enforce_circuit_breakers,
    flush_proxy_daily_rollups_now,
    get_proxy_telemetry,
    get_youtube_proxy_pool_stats,
    probe_paused_providers,
    run_youtube_proxy_pool_action,
    set_provider_proxy_paused,
    set_provider_proxy_quarantined,
    set_proxy_paused,
)
from backend.referrals import get_referral_analytics
from backend.storage_handler import cleanup_expired_local_artifacts, get_local_artifact_stats
from backend.tasks import download_delivery_task

router = APIRouter(prefix="/api/owner", tags=["owner"])
ROLLUP_REFRESH_STATE: dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_source_rows": 0,
    "last_rollup_rows": 0,
    "last_error": None,
}
REVENUE_ROLLUP_REFRESH_STATE: dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_source_rows": 0,
    "last_rollup_rows": 0,
    "last_error": None,
}
AUDIT_ROLLUP_REFRESH_STATE: dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_source_rows": 0,
    "last_rollup_rows": 0,
    "last_error": None,
}
SUBSCRIPTION_ROLLUP_REFRESH_STATE: dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_source_rows": 0,
    "last_rollup_rows": 0,
    "last_error": None,
}
ABUSE_ROLLUP_REFRESH_STATE: dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_source_rows": 0,
    "last_rollup_rows": 0,
    "last_error": None,
}
PROXY_ROLLUP_REFRESH_STATE: dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_source_rows": 0,
    "last_rollup_rows": 0,
    "last_error": None,
}
PROXY_ALERT_SNAPSHOT_STATE: dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_source_rows": 0,
    "last_rollup_rows": 0,
    "last_error": None,
}
PROXY_ALERT_ROLLUP_REFRESH_STATE: dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_source_rows": 0,
    "last_rollup_rows": 0,
    "last_error": None,
}
PROXY_BREAKER_POSTURE_ROLLUP_REFRESH_STATE: dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_source_rows": 0,
    "last_rollup_rows": 0,
    "last_error": None,
}
BILLING_RECONCILIATION_STATE: dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_source_rows": 0,
    "last_reconciled_rows": 0,
    "last_skipped_rows": 0,
    "last_error": None,
    "provider_counts": {},
    "status_counts": {},
}
PROXY_AUTOMATION_RUN_STATE: dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_error": None,
    "breaker_result": None,
    "probe_result": None,
    "quarantined_providers": [],
}
REVENUE_EVENT_SOURCE_HINT = "payment_events"
OWNER_AUDIT_SOURCE_HINT = "abuse_events"
RUNTIME_CONTROLS_REDIS_KEY = "nexus:runtime_controls:v1"


class UserStatusPayload(BaseModel):
    reason: str | None = None


class UserMutationPayload(BaseModel):
    role: str | None = None
    plan: str | None = None
    reason: str | None = None
    reset_usage: bool = False


class JobActionResponse(BaseModel):
    job_id: str
    status: str
    message: str
    new_job_id: str | None = None


class ProxyActionPayload(BaseModel):
    reason: str | None = None


class ProxyProviderActionPayload(BaseModel):
    provider: str
    reason: str | None = None


class KeyMutationPayload(BaseModel):
    name: str | None = None
    scopes: list[str] | None = None
    rate_limit: int | None = None


class JobPriorityPayload(BaseModel):
    priority: str | None = None
    reason: str | None = None


class CreditGrantPayload(BaseModel):
    bonus_download_credits: int = 0
    bonus_api_credits: int = 0
    reason: str | None = None


class EnterpriseAccountMutationPayload(BaseModel):
    plan: str | None = None
    custom_daily_quota: int | None = None
    custom_rate_limit: int | None = None
    custom_concurrency_limit: int | None = None
    webhooks_enabled: bool | None = None
    priority_lane: str | None = None
    retention_hours: int | None = None
    notes: str | None = None
    reason: str | None = None


class EnterpriseKeyOverridePayload(BaseModel):
    plan_tier_override: str | None = None
    custom_daily_quota: int | None = None
    custom_rate_limit: int | None = None
    custom_concurrency_limit: int | None = None
    webhooks_enabled: bool | None = None
    priority_lane: str | None = None
    retention_hours: int | None = None
    notes: str | None = None


class RuntimeControlPayload(BaseModel):
    reason: str | None = None


class KeyThrottlePayload(BaseModel):
    rate_limit: int | None = None
    reason: str | None = None


class ProxyAutomationPayload(BaseModel):
    action: str | None = None
    reason: str | None = None


def _require_owner(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_owner"):
        raise HTTPException(status_code=403, detail="Owner access required.")
    return user


async def _fetch_table_rows(table: str, *, limit: int = 50, order_column: str = "created_at") -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = supabase.table(table).select("*").order(order_column, desc=True).limit(limit).execute()
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


def _default_runtime_controls() -> dict[str, Any]:
    return {
        "maintenance_mode": False,
        "queue_drain_mode": False,
        "updated_at": None,
        "updated_by": None,
        "reason": None,
    }


async def get_runtime_ops_state() -> dict[str, Any]:
    redis_client = await ensure_redis_or_fail()
    raw_value = await redis_client.get(RUNTIME_CONTROLS_REDIS_KEY)
    if not raw_value:
        return _default_runtime_controls()

    try:
        if isinstance(raw_value, bytes):
            raw_value = raw_value.decode("utf-8")
        parsed = json.loads(raw_value)
        controls = _default_runtime_controls()
        controls.update(parsed if isinstance(parsed, dict) else {})
        controls["maintenance_mode"] = bool(controls.get("maintenance_mode"))
        controls["queue_drain_mode"] = bool(controls.get("queue_drain_mode"))
        return controls
    except Exception:
        return _default_runtime_controls()


async def set_runtime_ops_state(
    *,
    maintenance_mode: bool | None = None,
    queue_drain_mode: bool | None = None,
    actor_user_id: str | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    redis_client = await ensure_redis_or_fail()
    current = await get_runtime_ops_state()
    if maintenance_mode is not None:
        current["maintenance_mode"] = bool(maintenance_mode)
    if queue_drain_mode is not None:
        current["queue_drain_mode"] = bool(queue_drain_mode)
    current["updated_at"] = datetime.now(timezone.utc).isoformat()
    current["updated_by"] = actor_user_id
    current["reason"] = reason
    await redis_client.set(RUNTIME_CONTROLS_REDIS_KEY, json.dumps(current))
    return current


async def _fetch_media_history(limit: int = 200) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("media_history")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_revenue_rollups(limit: int = 365) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("revenue_rollups_daily")
                .select("*")
                .order("day", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_revenue_events(limit: int = 200) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        global REVENUE_EVENT_SOURCE_HINT
        primary_table = "payment_logs" if REVENUE_EVENT_SOURCE_HINT == "payment_logs" else "payment_events"
        fallback_table = "payment_events" if primary_table == "payment_logs" else "payment_logs"

        def _normalize(table_name: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
            if table_name == "payment_logs":
                return rows
            normalized: list[dict[str, Any]] = []
            for row in rows:
                payload = row.get("payload") or {}
                normalized.append(
                    {
                        "id": row.get("id"),
                        "user_id": row.get("user_id"),
                        "event_type": row.get("event_type"),
                        "plan": payload.get("plan") or payload.get("plan_code") or payload.get("tier"),
                        "razorpay_order_id": row.get("provider_order_id") or payload.get("razorpay_order_id"),
                        "razorpay_payment_id": payload.get("razorpay_payment_id") or payload.get("payment_id"),
                        "payload": payload,
                        "provider": row.get("provider"),
                        "created_at": row.get("created_at"),
                    }
                )
            return normalized

        try:
            result = (
                supabase.table(primary_table)
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            rows = result.data or []
            REVENUE_EVENT_SOURCE_HINT = primary_table
            return _normalize(primary_table, rows)
        except Exception:
            pass

        try:
            result = (
                supabase.table(fallback_table)
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            fallback_rows = result.data or []
            REVENUE_EVENT_SOURCE_HINT = fallback_table
            return _normalize(fallback_table, fallback_rows)
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_subscriptions(limit: int = 500) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
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

    return await asyncio.to_thread(_query)


async def _fetch_audit_rollups(limit: int = 365) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("audit_rollups_daily")
                .select("*")
                .order("day", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_subscription_rollups(limit: int = 365) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("subscription_rollups_daily")
                .select("*")
                .order("day", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_abuse_rollups(limit: int = 365) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("abuse_rollups_daily")
                .select("*")
                .order("day", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_proxy_burn_events(limit: int = 200) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("proxy_burn_events")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_proxy_daily_rollups(limit: int = 365) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("proxy_daily_rollups")
                .select("*")
                .order("rollup_date", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_proxy_alert_snapshots(limit: int = 200) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("proxy_alert_snapshots_daily")
                .select("*")
                .order("snapshot_date", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_proxy_alert_history(limit: int = 200) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("proxy_alert_history")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_proxy_alert_rollups(limit: int = 365) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("proxy_alert_rollups_daily")
                .select("*")
                .order("day", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_proxy_breaker_posture_rollups(limit: int = 365) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("proxy_breaker_posture_rollups_daily")
                .select("*")
                .order("day", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_paddle_waitlist_requests(limit: int = 100) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            rows = (
                supabase.table("stripe_waitlist")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            ).data or []
        except Exception:
            try:
                rows = (
                    supabase.table("stripe_access_requests")
                    .select("*")
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                ).data or []
            except Exception:
                return []

        user_ids = sorted({str(row.get("user_id") or "") for row in rows if row.get("user_id")})
        profiles_by_id: dict[str, dict[str, Any]] = {}
        if user_ids:
            try:
                profile_rows = (
                    supabase.table("profiles")
                    .select("id,email,plan,role")
                    .in_("id", user_ids)
                    .execute()
                ).data or []
                profiles_by_id = {str(profile.get("id")): profile for profile in profile_rows if profile.get("id")}
            except Exception:
                profiles_by_id = {}

        enriched: list[dict[str, Any]] = []
        for row in rows:
            profile = profiles_by_id.get(str(row.get("user_id") or "")) or {}
            enriched.append(
                {
                    "id": row.get("id"),
                    "user_id": row.get("user_id"),
                    "email": row.get("email") or profile.get("email"),
                    "profile_plan": profile.get("plan"),
                    "profile_role": profile.get("role"),
                    "requested_plan": row.get("desired_plan") or row.get("requested_plan"),
                    "country_code": row.get("country_code"),
                    "status": row.get("status"),
                    "created_at": row.get("created_at"),
                }
            )
        return enriched

    return await asyncio.to_thread(_query)


async def _fetch_billing_incidents(limit: int = 200) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("billing_incidents")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_delivery_incidents(limit: int = 200) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("delivery_incidents")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_queue_incidents(limit: int = 200) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("queue_incidents")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_proxy_efficiency_aggregate(window_days: int) -> list[dict[str, Any]]:
    if not supabase:
        return []

    since_date = (datetime.now(timezone.utc).date() - timedelta(days=max(window_days - 1, 0))).isoformat()

    def _query():
        try:
            result = (
                supabase.table("proxy_daily_rollups")
                .select(
                    "provider_name,"
                    "sum_total_probes:total_probes.sum(),"
                    "sum_successful_probes:successful_probes.sum(),"
                    "sum_burn_events:burn_events.sum(),"
                    "sum_estimated_cost_usd:estimated_cost_usd.sum()"
                )
                .gte("rollup_date", since_date)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_media_history_filtered(
    *,
    limit: int = 200,
    delivery_mode: str | None = None,
    platform: str | None = None,
    format_type: str | None = None,
) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            query = supabase.table("media_history").select("*").order("created_at", desc=True).limit(limit)
            if delivery_mode:
                query = query.eq("delivery_mode", delivery_mode)
            if platform:
                query = query.eq("platform", platform)
            if format_type:
                query = query.eq("format_type", format_type)
            result = query.execute()
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _fetch_vault_history_rollups(limit: int = 365) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("vault_history_rollups_daily")
                .select("*")
                .order("day", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


def _build_history_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    delivery_modes: dict[str, int] = {}
    format_types: dict[str, int] = {}
    platform_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}
    fallback_count = 0

    for row in rows:
        delivery_mode = str(row.get("delivery_mode") or "unknown").lower()
        format_type = str(row.get("format_type") or "unknown").lower()
        platform = str(row.get("platform") or "unknown").lower()
        created_at = str(row.get("created_at") or "")
        delivery_modes[delivery_mode] = delivery_modes.get(delivery_mode, 0) + 1
        format_types[format_type] = format_types.get(format_type, 0) + 1
        platform_counts[platform] = platform_counts.get(platform, 0) + 1
        if row.get("fallback_url"):
            fallback_count += 1
        if created_at:
            daily_key = created_at[:10]
            daily_counts[daily_key] = daily_counts.get(daily_key, 0) + 1

    recent = [
        {
            "id": row.get("id"),
            "title": row.get("title"),
            "platform": row.get("platform"),
            "delivery_mode": row.get("delivery_mode"),
            "format_type": row.get("format_type"),
            "created_at": row.get("created_at"),
        }
        for row in rows[:10]
    ]

    return {
        "entries_total": len(rows),
        "fallback_entries": fallback_count,
        "delivery_modes": delivery_modes,
        "format_types": format_types,
        "platform_counts": platform_counts,
        "daily_counts": daily_counts,
        "recent_entries": recent,
    }


def _build_revenue_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    daily_counts: dict[str, int] = {}
    event_types: dict[str, int] = {}
    plan_counts: dict[str, int] = {}

    for row in rows:
        created_at = str(row.get("created_at") or "")
        day = created_at[:10] if created_at else ""
        event_type = str(row.get("event_type") or "unknown").lower()
        plan_code = str((row.get("payload") or {}).get("plan") or row.get("plan") or "unknown").lower()
        daily_counts[day] = daily_counts.get(day, 0) + 1 if day else daily_counts.get(day, 0)
        event_types[event_type] = event_types.get(event_type, 0) + 1
        plan_counts[plan_code] = plan_counts.get(plan_code, 0) + 1

    return {
        "events_total": len(rows),
        "captured_total": len([row for row in rows if str(row.get("event_type") or "").lower() in {"captured", "verified_frontend"}]),
        "daily_counts": daily_counts,
        "event_types": event_types,
        "plan_counts": plan_counts,
        "recent_events": [
            {
                "user_id": row.get("user_id"),
                "event_type": row.get("event_type"),
                "order_id": row.get("razorpay_order_id"),
                "created_at": row.get("created_at"),
            }
            for row in rows[:20]
        ],
    }


def _build_billing_incident_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    provider_counts: dict[str, int] = {}
    incident_type_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}

    for row in rows:
        provider = str(row.get("provider") or "unknown").lower()
        incident_type = str(row.get("incident_type") or "unknown").lower()
        created_at = str(row.get("created_at") or "")
        provider_counts[provider] = provider_counts.get(provider, 0) + 1
        incident_type_counts[incident_type] = incident_type_counts.get(incident_type, 0) + 1
        if created_at:
            day = created_at[:10]
            daily_counts[day] = daily_counts.get(day, 0) + 1

    return {
        "events_total": len(rows),
        "provider_counts": provider_counts,
        "incident_type_counts": incident_type_counts,
        "daily_counts": daily_counts,
        "recent_events": [
            {
                "provider": row.get("provider"),
                "incident_type": row.get("incident_type"),
                "event_type": row.get("event_type"),
                "provider_reference": row.get("provider_reference"),
                "detail": row.get("detail"),
                "status_code": row.get("status_code"),
                "created_at": row.get("created_at"),
            }
            for row in rows[:20]
        ],
    }


def _build_delivery_incident_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    provider_counts: dict[str, int] = {}
    incident_type_counts: dict[str, int] = {}
    artifact_mode_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}

    for row in rows:
        provider = str(row.get("provider") or "unknown").lower()
        incident_type = str(row.get("incident_type") or "unknown").lower()
        artifact_mode = str(row.get("artifact_mode") or "unknown").lower()
        created_at = str(row.get("created_at") or "")
        provider_counts[provider] = provider_counts.get(provider, 0) + 1
        incident_type_counts[incident_type] = incident_type_counts.get(incident_type, 0) + 1
        artifact_mode_counts[artifact_mode] = artifact_mode_counts.get(artifact_mode, 0) + 1
        if created_at:
            day = created_at[:10]
            daily_counts[day] = daily_counts.get(day, 0) + 1

    return {
        "events_total": len(rows),
        "provider_counts": provider_counts,
        "incident_type_counts": incident_type_counts,
        "artifact_mode_counts": artifact_mode_counts,
        "daily_counts": daily_counts,
        "recent_events": [
            {
                "provider": row.get("provider"),
                "incident_type": row.get("incident_type"),
                "artifact_mode": row.get("artifact_mode"),
                "job_id": row.get("job_id"),
                "filename": row.get("filename"),
                "detail": row.get("detail"),
                "created_at": row.get("created_at"),
            }
            for row in rows[:20]
        ],
    }


def _build_queue_incident_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    provider_counts: dict[str, int] = {}
    incident_type_counts: dict[str, int] = {}
    queue_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}

    for row in rows:
        provider = str(row.get("provider") or "unknown").lower()
        incident_type = str(row.get("incident_type") or "unknown").lower()
        queue_name = str(row.get("queue_name") or "unknown").lower()
        created_at = str(row.get("created_at") or "")
        provider_counts[provider] = provider_counts.get(provider, 0) + 1
        incident_type_counts[incident_type] = incident_type_counts.get(incident_type, 0) + 1
        queue_counts[queue_name] = queue_counts.get(queue_name, 0) + 1
        if created_at:
            day = created_at[:10]
            daily_counts[day] = daily_counts.get(day, 0) + 1

    return {
        "events_total": len(rows),
        "provider_counts": provider_counts,
        "incident_type_counts": incident_type_counts,
        "queue_counts": queue_counts,
        "daily_counts": daily_counts,
        "recent_events": [
            {
                "provider": row.get("provider"),
                "incident_type": row.get("incident_type"),
                "queue_name": row.get("queue_name"),
                "job_id": row.get("job_id"),
                "runner": row.get("runner"),
                "detail": row.get("detail"),
                "created_at": row.get("created_at"),
            }
            for row in rows[:20]
        ],
    }


def _build_subscription_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    status_counts: dict[str, int] = {}
    plan_counts: dict[str, int] = {}
    provider_counts: dict[str, int] = {}
    expiring_soon = 0
    canceling = 0
    recent: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)

    for row in rows:
        status = str(row.get("status") or "unknown").lower()
        plan_code = str(row.get("plan_code") or "unknown").lower()
        provider = str(row.get("provider") or "unknown").lower()
        status_counts[status] = status_counts.get(status, 0) + 1
        plan_counts[plan_code] = plan_counts.get(plan_code, 0) + 1
        provider_counts[provider] = provider_counts.get(provider, 0) + 1

        if row.get("cancel_at_period_end"):
            canceling += 1

        current_period_end = row.get("current_period_end")
        if current_period_end:
            try:
                expiry = datetime.fromisoformat(str(current_period_end).replace("Z", "+00:00"))
                if expiry.tzinfo is None:
                    expiry = expiry.replace(tzinfo=timezone.utc)
                if now <= expiry <= now + timedelta(days=7):
                    expiring_soon += 1
            except Exception:
                pass

        if len(recent) < 20:
            recent.append(
                {
                    "user_id": row.get("user_id"),
                    "provider": row.get("provider"),
                    "status": row.get("status"),
                    "plan_code": row.get("plan_code"),
                    "current_period_end": row.get("current_period_end"),
                    "cancel_at_period_end": row.get("cancel_at_period_end"),
                    "created_at": row.get("created_at"),
                }
            )

    active_count = sum(count for key, count in status_counts.items() if key in {"active", "trialing"})
    return {
        "subscriptions_total": len(rows),
        "active_count": active_count,
        "status_counts": status_counts,
        "plan_counts": plan_counts,
        "provider_counts": provider_counts,
        "expiring_soon": expiring_soon,
        "canceling": canceling,
        "recent_subscriptions": recent,
    }


def _build_subscription_rollup_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    next_seven_days = now + timedelta(days=7)
    now_iso = now.isoformat()

    for row in rows:
        created_at = str(row.get("created_at") or "")
        day = created_at[:10] if created_at else today
        status = str(row.get("status") or "unknown").lower()
        plan_code = str(row.get("plan_code") or "unknown").lower()
        provider = str(row.get("provider") or "unknown").lower()
        key = (day, status, plan_code, provider)
        current = buckets.get(key)
        if current is None:
            current = {
                "day": day,
                "status": status,
                "plan_code": plan_code,
                "provider": provider,
                "subscription_count": 0,
                "active_count": 0,
                "expiring_soon_count": 0,
                "canceling_count": 0,
                "updated_at": now_iso,
            }
            buckets[key] = current

        current["subscription_count"] += 1
        if status in {"active", "trialing"}:
            current["active_count"] += 1
        if row.get("cancel_at_period_end"):
            current["canceling_count"] += 1

        current_period_end = row.get("current_period_end")
        if current_period_end:
            try:
                expiry = datetime.fromisoformat(str(current_period_end).replace("Z", "+00:00"))
                if expiry.tzinfo is None:
                    expiry = expiry.replace(tzinfo=timezone.utc)
                if now <= expiry <= next_seven_days:
                    current["expiring_soon_count"] += 1
            except Exception:
                pass

    return list(buckets.values())


def _build_subscription_analytics_from_rollups(rows: list[dict[str, Any]]) -> dict[str, Any]:
    status_counts: dict[str, int] = {}
    plan_counts: dict[str, int] = {}
    provider_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}
    subscriptions_total = 0
    active_count = 0
    expiring_soon = 0
    canceling = 0

    for row in rows:
        day = str(row.get("day") or "")
        status = str(row.get("status") or "unknown").lower()
        plan_code = str(row.get("plan_code") or "unknown").lower()
        provider = str(row.get("provider") or "unknown").lower()
        subscription_count = int(row.get("subscription_count") or 0)
        active_bucket = int(row.get("active_count") or 0)
        expiring_bucket = int(row.get("expiring_soon_count") or 0)
        canceling_bucket = int(row.get("canceling_count") or 0)

        subscriptions_total += subscription_count
        active_count += active_bucket
        expiring_soon += expiring_bucket
        canceling += canceling_bucket
        status_counts[status] = status_counts.get(status, 0) + subscription_count
        plan_counts[plan_code] = plan_counts.get(plan_code, 0) + subscription_count
        provider_counts[provider] = provider_counts.get(provider, 0) + subscription_count
        if day:
            daily_counts[day] = daily_counts.get(day, 0) + subscription_count

    return {
        "subscriptions_total": subscriptions_total,
        "active_count": active_count,
        "status_counts": status_counts,
        "plan_counts": plan_counts,
        "provider_counts": provider_counts,
        "expiring_soon": expiring_soon,
        "canceling": canceling,
        "daily_counts": daily_counts,
        "recent_subscriptions": [],
    }


def _build_abuse_rollup_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str], dict[str, Any]] = {}
    now_iso = datetime.now(timezone.utc).isoformat()
    for row in rows:
        created_at = str(row.get("created_at") or "")
        day = created_at[:10] if created_at else datetime.now(timezone.utc).date().isoformat()
        event_type = str(row.get("event_type") or "unknown").lower()
        key = (day, event_type)
        current = buckets.get(key)
        if current is None:
            current = {
                "day": day,
                "event_type": event_type,
                "event_count": 0,
                "updated_at": now_iso,
            }
            buckets[key] = current
        current["event_count"] += 1
    return list(buckets.values())


def _build_abuse_analytics_from_rollups(rows: list[dict[str, Any]]) -> dict[str, Any]:
    event_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}
    events_total = 0

    for row in rows:
        day = str(row.get("day") or "")
        event_type = str(row.get("event_type") or "unknown").lower()
        event_count = int(row.get("event_count") or 0)
        event_counts[event_type] = event_counts.get(event_type, 0) + event_count
        if day:
            daily_counts[day] = daily_counts.get(day, 0) + event_count
        events_total += event_count

    return {
        "events_total": events_total,
        "event_counts": event_counts,
        "daily_counts": daily_counts,
        "affected_users": 0,
        "recent_events": [],
    }


def _build_revenue_rollup_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in rows:
        created_at = str(row.get("created_at") or "")
        day = created_at[:10] if created_at else datetime.now(timezone.utc).date().isoformat()
        event_type = str(row.get("event_type") or "unknown").lower()
        plan_code = str((row.get("payload") or {}).get("plan") or row.get("plan") or "unknown").lower()
        key = (day, event_type, plan_code)
        current = buckets.get(key)
        if current is None:
            current = {
                "day": day,
                "event_type": event_type,
                "plan_code": plan_code,
                "event_count": 0,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            buckets[key] = current
        current["event_count"] += 1
    return list(buckets.values())


def _build_revenue_analytics_from_rollups(rows: list[dict[str, Any]]) -> dict[str, Any]:
    daily_counts: dict[str, int] = {}
    event_types: dict[str, int] = {}
    plan_counts: dict[str, int] = {}
    events_total = 0
    captured_total = 0

    for row in rows:
        day = str(row.get("day") or "")
        event_type = str(row.get("event_type") or "unknown").lower()
        plan_code = str(row.get("plan_code") or "unknown").lower()
        event_count = int(row.get("event_count") or 0)
        if day:
            daily_counts[day] = daily_counts.get(day, 0) + event_count
        event_types[event_type] = event_types.get(event_type, 0) + event_count
        plan_counts[plan_code] = plan_counts.get(plan_code, 0) + event_count
        events_total += event_count
        if event_type in {"captured", "verified_frontend"}:
            captured_total += event_count

    return {
        "events_total": events_total,
        "captured_total": captured_total,
        "daily_counts": daily_counts,
        "event_types": event_types,
        "plan_counts": plan_counts,
        "recent_events": [],
    }


def _build_rollup_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for row in rows:
        created_at = str(row.get("created_at") or "")
        day = created_at[:10] if created_at else datetime.now(timezone.utc).date().isoformat()
        delivery_mode = str(row.get("delivery_mode") or "unknown").lower()
        platform = str(row.get("platform") or "unknown").lower()
        format_type = str(row.get("format_type") or "unknown").lower()
        key = (day, delivery_mode, platform, format_type)
        current = buckets.get(key)
        if current is None:
            current = {
                "day": day,
                "delivery_mode": delivery_mode,
                "platform": platform,
                "format_type": format_type,
                "entry_count": 0,
                "fallback_count": 0,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            buckets[key] = current
        current["entry_count"] += 1
        if row.get("fallback_url"):
            current["fallback_count"] += 1
    return list(buckets.values())


def _build_history_analytics_from_rollups(rows: list[dict[str, Any]]) -> dict[str, Any]:
    delivery_modes: dict[str, int] = {}
    format_types: dict[str, int] = {}
    platform_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}
    fallback_entries = 0
    entries_total = 0

    for row in rows:
        delivery_mode = str(row.get("delivery_mode") or "unknown").lower()
        format_type = str(row.get("format_type") or "unknown").lower()
        platform = str(row.get("platform") or "unknown").lower()
        day = str(row.get("day") or "")
        entry_count = int(row.get("entry_count") or 0)
        fallback_count = int(row.get("fallback_count") or 0)

        delivery_modes[delivery_mode] = delivery_modes.get(delivery_mode, 0) + entry_count
        format_types[format_type] = format_types.get(format_type, 0) + entry_count
        platform_counts[platform] = platform_counts.get(platform, 0) + entry_count
        if day:
            daily_counts[day] = daily_counts.get(day, 0) + entry_count
        fallback_entries += fallback_count
        entries_total += entry_count

    return {
        "entries_total": entries_total,
        "fallback_entries": fallback_entries,
        "delivery_modes": delivery_modes,
        "format_types": format_types,
        "platform_counts": platform_counts,
        "daily_counts": daily_counts,
        "recent_entries": [],
    }


async def _get_history_analytics_with_rollup_fallback(limit: int = 200) -> dict[str, Any]:
    rollups = await _fetch_vault_history_rollups(limit=365)
    if rollups:
        analytics = _build_history_analytics_from_rollups(rollups)
        analytics["source"] = "rollup"
        return analytics

    media_history = await _fetch_media_history(limit=limit)
    analytics = _build_history_analytics(media_history)
    analytics["source"] = "live"
    return analytics


async def _get_revenue_analytics_with_rollup_fallback(limit: int = 200) -> dict[str, Any]:
    rollups = await _fetch_revenue_rollups(limit=365)
    if rollups:
        analytics = _build_revenue_analytics_from_rollups(rollups)
        analytics["source"] = "rollup"
        return analytics

    rows = await _fetch_revenue_events(limit=limit)
    analytics = _build_revenue_analytics(rows)
    analytics["source"] = "live"
    return analytics


async def _get_audit_analytics_with_rollup_fallback(limit: int = 200) -> dict[str, Any]:
    rollups = await _fetch_audit_rollups(limit=365)
    if rollups:
        analytics = _build_audit_analytics_from_rollups(rollups)
        analytics["source"] = "rollup"
        return analytics

    rows = await _fetch_owner_audit_events(limit=limit)
    analytics = _build_audit_analytics(rows)
    analytics["source"] = "live"
    return analytics


async def _get_subscription_analytics_with_rollup_fallback(limit: int = 500) -> dict[str, Any]:
    rollups = await _fetch_subscription_rollups(limit=365)
    if rollups:
        analytics = _build_subscription_analytics_from_rollups(rollups)
        analytics["source"] = "rollup"
        return analytics

    rows = await _fetch_subscriptions(limit=limit)
    analytics = _build_subscription_analytics(rows)
    analytics["source"] = "live"
    return analytics


async def _get_abuse_analytics_with_rollup_fallback(limit: int = 200) -> dict[str, Any]:
    rollups = await _fetch_abuse_rollups(limit=365)
    if rollups:
        analytics = _build_abuse_analytics_from_rollups(rollups)
        analytics["source"] = "rollup"
        return analytics

    rows = await _fetch_table_rows("abuse_events", limit=limit)
    analytics = _build_abuse_analytics(rows)
    analytics["source"] = "live"
    return analytics


async def _get_proxy_breaker_history_with_rollup_fallback(limit: int = 200) -> dict[str, Any]:
    rollups = await _fetch_proxy_alert_rollups(limit=365)
    if rollups:
        recent_rows = await _fetch_proxy_alert_history(limit=min(limit, 20))
        analytics = _build_proxy_alert_history_analytics_from_rollups(rollups, recent_rows=recent_rows)
        analytics["source"] = "rollup"
        return analytics

    rows = await _fetch_proxy_alert_history(limit=limit)
    analytics = _build_proxy_alert_history_analytics(rows)
    analytics["source"] = "table" if rows else "table_empty"
    return analytics


async def _get_proxy_breaker_posture_history(limit: int = 365) -> dict[str, Any]:
    rows = await _fetch_proxy_breaker_posture_rollups(limit=limit)
    return _build_proxy_breaker_posture_history_from_rollups(rows)


async def _persist_history_rollups(rows: list[dict[str, Any]]) -> bool:
    if not supabase:
        return False
    payload = _build_rollup_rows(rows)
    if not payload:
        return True

    def _query() -> bool:
        try:
            supabase.table("vault_history_rollups_daily").upsert(payload).execute()
            return True
        except Exception:
            return False

    return await asyncio.to_thread(_query)


async def _persist_revenue_rollups(rows: list[dict[str, Any]]) -> bool:
    if not supabase:
        return False
    payload = _build_revenue_rollup_rows(rows)
    if not payload:
        return True

    def _query() -> bool:
        try:
            supabase.table("revenue_rollups_daily").upsert(payload).execute()
            return True
        except Exception:
            return False

    return await asyncio.to_thread(_query)


async def _persist_audit_rollups(rows: list[dict[str, Any]]) -> bool:
    if not supabase:
        return False
    payload = _build_audit_rollup_rows(rows)
    if not payload:
        return True

    def _query() -> bool:
        try:
            supabase.table("audit_rollups_daily").upsert(payload).execute()
            return True
        except Exception:
            return False

    return await asyncio.to_thread(_query)


async def _persist_subscription_rollups(rows: list[dict[str, Any]]) -> bool:
    if not supabase:
        return False
    payload = _build_subscription_rollup_rows(rows)
    if not payload:
        return True

    def _query() -> bool:
        try:
            supabase.table("subscription_rollups_daily").upsert(payload).execute()
            return True
        except Exception:
            return False

    return await asyncio.to_thread(_query)


async def _persist_abuse_rollups(rows: list[dict[str, Any]]) -> bool:
    if not supabase:
        return False
    payload = _build_abuse_rollup_rows(rows)
    if not payload:
        return True

    def _query() -> bool:
        try:
            supabase.table("abuse_rollups_daily").upsert(payload).execute()
            return True
        except Exception:
            return False

    return await asyncio.to_thread(_query)


async def _persist_proxy_alert_rollups(rows: list[dict[str, Any]]) -> bool:
    if not supabase:
        return False
    payload = _build_proxy_alert_rollup_rows(rows)
    if not payload:
        return True

    def _query() -> bool:
        try:
            supabase.table("proxy_alert_rollups_daily").upsert(payload).execute()
            return True
        except Exception:
            return False

    return await asyncio.to_thread(_query)


async def _persist_proxy_breaker_posture_rollup(proxy_breaker_posture: dict[str, Any]) -> bool:
    if not supabase:
        return False
    payload = _build_proxy_breaker_posture_rollup_row(proxy_breaker_posture)

    def _query() -> bool:
        try:
            supabase.table("proxy_breaker_posture_rollups_daily").upsert(payload).execute()
            return True
        except Exception:
            return False

    return await asyncio.to_thread(_query)


async def refresh_history_rollups_best_effort() -> dict[str, Any]:
    rows = await _fetch_media_history(limit=5000)
    payload = _build_rollup_rows(rows)
    persisted = await _persist_history_rollups(rows)
    ROLLUP_REFRESH_STATE.update(
        {
            "status": "ok" if persisted else "skipped",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_source_rows": len(rows),
            "last_rollup_rows": len(payload),
            "last_error": None if persisted else "rollup table unavailable or persistence skipped",
        }
    )
    return {
        "status": "ok" if persisted else "skipped",
        "rollup_rows": len(payload),
        "source_rows": len(rows),
        "persisted": persisted,
    }


async def refresh_revenue_rollups_best_effort() -> dict[str, Any]:
    rows = await _fetch_revenue_events(limit=5000)
    payload = _build_revenue_rollup_rows(rows)
    persisted = await _persist_revenue_rollups(rows)
    REVENUE_ROLLUP_REFRESH_STATE.update(
        {
            "status": "ok" if persisted else "skipped",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_source_rows": len(rows),
            "last_rollup_rows": len(payload),
            "last_error": None if persisted else "rollup table unavailable or persistence skipped",
        }
    )
    return {
        "status": "ok" if persisted else "skipped",
        "rollup_rows": len(payload),
        "source_rows": len(rows),
        "persisted": persisted,
    }


async def refresh_audit_rollups_best_effort() -> dict[str, Any]:
    rows = await _fetch_owner_audit_events(limit=5000)
    payload = _build_audit_rollup_rows(rows)
    persisted = await _persist_audit_rollups(rows)
    AUDIT_ROLLUP_REFRESH_STATE.update(
        {
            "status": "ok" if persisted else "skipped",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_source_rows": len(rows),
            "last_rollup_rows": len(payload),
            "last_error": None if persisted else "rollup table unavailable or persistence skipped",
        }
    )
    return {
        "status": "ok" if persisted else "skipped",
        "rollup_rows": len(payload),
        "source_rows": len(rows),
        "persisted": persisted,
    }


async def refresh_subscription_rollups_best_effort() -> dict[str, Any]:
    rows = await _fetch_subscriptions(limit=5000)
    payload = _build_subscription_rollup_rows(rows)
    persisted = await _persist_subscription_rollups(rows)
    SUBSCRIPTION_ROLLUP_REFRESH_STATE.update(
        {
            "status": "ok" if persisted else "skipped",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_source_rows": len(rows),
            "last_rollup_rows": len(payload),
            "last_error": None if persisted else "rollup table unavailable or persistence skipped",
        }
    )
    return {
        "status": "ok" if persisted else "skipped",
        "rollup_rows": len(payload),
        "source_rows": len(rows),
        "persisted": persisted,
    }


async def refresh_billing_reconciliation_best_effort() -> dict[str, Any]:
    result = await reconcile_subscriptions_best_effort(limit=500)
    BILLING_RECONCILIATION_STATE.update(
        {
            "status": result.get("status") or "unknown",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_source_rows": result.get("source_rows", 0),
            "last_reconciled_rows": result.get("reconciled_rows", 0),
            "last_skipped_rows": result.get("skipped_rows", 0),
            "last_error": None if result.get("status") == "ok" else result.get("reason"),
            "provider_counts": result.get("provider_counts") or {},
            "status_counts": result.get("status_counts") or {},
        }
    )
    return result


async def refresh_abuse_rollups_best_effort() -> dict[str, Any]:
    rows = await _fetch_table_rows("abuse_events", limit=5000)
    payload = _build_abuse_rollup_rows(rows)
    persisted = await _persist_abuse_rollups(rows)
    ABUSE_ROLLUP_REFRESH_STATE.update(
        {
            "status": "ok" if persisted else "skipped",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_source_rows": len(rows),
            "last_rollup_rows": len(payload),
            "last_error": None if persisted else "rollup table unavailable or persistence skipped",
        }
    )
    return {
        "status": "ok" if persisted else "skipped",
        "rollup_rows": len(payload),
        "source_rows": len(rows),
        "persisted": persisted,
    }


async def refresh_proxy_rollups_best_effort() -> dict[str, Any]:
    result = await asyncio.to_thread(flush_proxy_daily_rollups_now)
    PROXY_ROLLUP_REFRESH_STATE.update(
        {
            "status": result.get("status", "skipped"),
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_source_rows": int(result.get("source_rows") or 0),
            "last_rollup_rows": int(result.get("rollup_rows") or 0),
            "last_error": result.get("reason"),
        }
    )
    return result


async def refresh_proxy_alert_rollups_best_effort() -> dict[str, Any]:
    rows = await _fetch_proxy_alert_history(limit=5000)
    payload = _build_proxy_alert_rollup_rows(rows)
    persisted = await _persist_proxy_alert_rollups(rows)
    PROXY_ALERT_ROLLUP_REFRESH_STATE.update(
        {
            "status": "ok" if persisted else "skipped",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_source_rows": len(rows),
            "last_rollup_rows": len(payload),
            "last_error": None if persisted else "proxy alert rollup persistence skipped",
        }
    )
    return {
        "status": "ok" if persisted else "skipped",
        "source_rows": len(rows),
        "rollup_rows": len(payload),
        "persisted": persisted,
    }


async def refresh_proxy_breaker_posture_rollups_best_effort() -> dict[str, Any]:
    proxy_telemetry = get_proxy_telemetry()
    proxy_breaker_history = await _get_proxy_breaker_history_with_rollup_fallback(limit=200)
    proxy_breaker_posture = _build_proxy_breaker_posture(proxy_telemetry, proxy_breaker_history)
    payload = _build_proxy_breaker_posture_rollup_row(proxy_breaker_posture)
    persisted = await _persist_proxy_breaker_posture_rollup(proxy_breaker_posture)
    PROXY_BREAKER_POSTURE_ROLLUP_REFRESH_STATE.update(
        {
            "status": "ok" if persisted else "skipped",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_source_rows": len(proxy_telemetry.get("auto_paused_provider_states") or {}),
            "last_rollup_rows": 1 if payload else 0,
            "last_error": None if persisted else "proxy breaker posture rollup persistence skipped",
        }
    )
    return {
        "status": "ok" if persisted else "skipped",
        "source_rows": len(proxy_telemetry.get("auto_paused_provider_states") or {}),
        "rollup_rows": 1 if payload else 0,
        "persisted": persisted,
    }


def _rows_to_csv(rows: list[dict[str, Any]], fieldnames: list[str]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key) for key in fieldnames})
    return buffer.getvalue()


async def _fetch_profiles(limit: int = 25) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = supabase.table("profiles").select("*").order("created_at", desc=True).limit(limit).execute()
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _get_worker_snapshot() -> dict[str, Any]:
    if not celery_available or celery_app is None or os.environ.get("NEXUS_USE_CELERY", "0") != "1":
        return {
            "inspect_ok": False,
            "workers_online": 0,
            "active_tasks": 0,
            "reserved_tasks": 0,
            "workers": [],
        }

    def _inspect_workers() -> dict[str, Any]:
        try:
            inspector = celery_app.control.inspect(timeout=0.5)
            ping = inspector.ping() or {}
            active = inspector.active() or {}
            reserved = inspector.reserved() or {}
            stats = inspector.stats() or {}
            worker_names = sorted(set(ping) | set(active) | set(reserved) | set(stats))
            workers = []
            for worker_name in worker_names:
                worker_stats = stats.get(worker_name) or {}
                pool = worker_stats.get("pool") or {}
                workers.append(
                    {
                        "name": worker_name,
                        "online": worker_name in ping or worker_name in stats,
                        "active": len(active.get(worker_name) or []),
                        "reserved": len(reserved.get(worker_name) or []),
                        "pool_max_concurrency": pool.get("max-concurrency"),
                        "processes": pool.get("processes") or [],
                    }
                )

            return {
                "inspect_ok": bool(worker_names),
                "workers_online": len([worker for worker in workers if worker.get("online")]),
                "active_tasks": sum(worker["active"] for worker in workers),
                "reserved_tasks": sum(worker["reserved"] for worker in workers),
                "workers": workers,
            }
        except Exception:
            return {
                "inspect_ok": False,
                "workers_online": 0,
                "active_tasks": 0,
                "reserved_tasks": 0,
                "workers": [],
            }

    return await asyncio.to_thread(_inspect_workers)


async def _build_owner_snapshot() -> dict[str, Any]:
    profiles = await _fetch_profiles(limit=200)
    payment_events = await _fetch_revenue_events(limit=100)
    revenue_analytics = await _get_revenue_analytics_with_rollup_fallback(limit=200)
    history_analytics = await _get_history_analytics_with_rollup_fallback(limit=200)
    subscription_analytics = await _get_subscription_analytics_with_rollup_fallback(limit=500)
    audit_analytics = await _get_audit_analytics_with_rollup_fallback(limit=200)
    abuse_analytics = await _get_abuse_analytics_with_rollup_fallback(limit=200)
    billing_incident_analytics = _build_billing_incident_analytics(await _fetch_billing_incidents(limit=200))
    proxy_history_analytics = _build_proxy_history_analytics(await _fetch_proxy_burn_events(limit=200))
    proxy_breaker_history_analytics = await _get_proxy_breaker_history_with_rollup_fallback(limit=200)
    proxy_rollup_analytics = _build_proxy_rollup_analytics(await _fetch_proxy_daily_rollups(limit=365))
    proxy_breaker_posture_history = await _get_proxy_breaker_posture_history(limit=365)
    proxy_efficiency_7d = _build_proxy_efficiency_metrics(await _fetch_proxy_efficiency_aggregate(7), window_days=7)
    proxy_efficiency_30d = _build_proxy_efficiency_metrics(await _fetch_proxy_efficiency_aggregate(30), window_days=30)
    proxy_efficiency_trends = _build_proxy_efficiency_trends(proxy_efficiency_7d, proxy_efficiency_30d)
    proxy_alert_snapshots = await _fetch_proxy_alert_snapshots(limit=30)
    jobs_summary = await summarize_jobs()
    system_health = await owner_system_health({"is_owner": True})
    proxy_breaker_posture = _build_proxy_breaker_posture(system_health.get("proxy_telemetry") or {}, proxy_breaker_history_analytics)
    proxy_cost_analytics = _build_proxy_cost_analytics(
        system_health.get("proxy_telemetry") or {},
        proxy_history_analytics,
        proxy_rollup_analytics,
    )
    owner_keys = await owner_keys({"is_owner": True})
    key_failure_alerts = await _build_api_key_failure_alerts(owner_keys)

    role_counts: dict[str, int] = {}
    plan_counts: dict[str, int] = {}
    active_subscribers = 0

    for profile in profiles:
        role = str(profile.get("role") or "user").lower()
        plan = str(profile.get("plan") or "free").lower()
        role_counts[role] = role_counts.get(role, 0) + 1
        plan_counts[plan] = plan_counts.get(plan, 0) + 1
        if plan in {"pro", "premium", "api", "api_growth", "enterprise"}:
            active_subscribers += 1

    recent_revenue = [
        {
            "user_id": row.get("user_id"),
            "event_type": row.get("event_type"),
            "order_id": row.get("razorpay_order_id"),
            "created_at": row.get("created_at"),
        }
        for row in payment_events[:20]
    ]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "users_total": len(profiles),
            "active_subscribers": active_subscribers,
            "role_counts": role_counts,
            "plan_counts": plan_counts,
            "jobs": {
                "total": jobs_summary["total_jobs"],
                "active": jobs_summary["active_jobs"],
                "statuses": jobs_summary["statuses"],
                "stages": jobs_summary["stages"],
            },
            "revenue_signals": {
                "payment_events": revenue_analytics["events_total"],
            },
            "vault_history": {
                "entries_total": history_analytics["entries_total"],
                "fallback_entries": history_analytics["fallback_entries"],
            },
            "subscriptions": {
                "total": subscription_analytics["subscriptions_total"],
                "active": subscription_analytics["active_count"],
                "expiring_soon": subscription_analytics["expiring_soon"],
            },
            "audit": {
                "events_total": audit_analytics["events_total"],
            },
            "abuse": {
                "events_total": abuse_analytics["events_total"],
            },
            "api_key_failure_alerts": {
                "flagged_total": key_failure_alerts["flagged_total"],
                "critical_total": key_failure_alerts["critical_total"],
                "high_total": key_failure_alerts["high_total"],
            },
            "billing_incidents": {
                "events_total": billing_incident_analytics["events_total"],
            },
            "proxy_history": {
                "events_total": proxy_history_analytics["events_total"],
                "burn_events": proxy_history_analytics["burn_events"],
            },
            "proxy_breaker_history": {
                "events_total": proxy_breaker_history_analytics["events_total"],
                "providers": len(proxy_breaker_history_analytics["provider_counts"]),
            },
            "proxy_breaker_posture": {
                "recurring_offenders": proxy_breaker_posture["total_recurring_offenders"],
                "quarantined": proxy_breaker_posture["total_quarantined"],
            },
            "proxy_breaker_posture_history": {
                "rows_total": proxy_breaker_posture_history["rows_total"],
                "source": proxy_breaker_posture_history["source"],
            },
            "proxy_rollups": {
                "rows_total": proxy_rollup_analytics["rows_total"],
                "total_probes": proxy_rollup_analytics["total_probes"],
                "successful_probes": proxy_rollup_analytics["successful_probes"],
                "failed_probes": proxy_rollup_analytics["failed_probes"],
            },
            "proxy_costs": {
                "estimated_total_cost": proxy_cost_analytics["estimated_total_cost"],
                "burn_rate_per_1000_probes": proxy_cost_analytics["burn_rate_per_1000_probes"],
            },
            "proxy_efficiency": {
                "providers_7d": len(proxy_efficiency_7d["providers"]),
                "providers_30d": len(proxy_efficiency_30d["providers"]),
                "alerts": len(proxy_efficiency_trends["alert_rows"]),
                "alert_snapshots": len(proxy_alert_snapshots),
            },
        },
        "jobs": {
            "summary": {
                "total_jobs": jobs_summary["total_jobs"],
                "active_jobs": jobs_summary["active_jobs"],
                "statuses": jobs_summary["statuses"],
                "queues": jobs_summary["queues"],
                "stages": jobs_summary["stages"],
                "runners": jobs_summary["runners"],
                "avg_active_progress": jobs_summary["avg_active_progress"],
            },
            "recent_jobs": jobs_summary["recent_jobs"],
        },
        "health": system_health,
        "revenue": {
            **revenue_analytics,
            "recent_events": revenue_analytics.get("recent_events") or recent_revenue,
            "vault_history": history_analytics,
            "subscriptions": subscription_analytics,
            "audit": audit_analytics,
            "abuse": abuse_analytics,
            "proxy_history": proxy_history_analytics,
            "proxy_breaker_history": proxy_breaker_history_analytics,
            "proxy_breaker_posture": proxy_breaker_posture,
            "proxy_breaker_posture_history": proxy_breaker_posture_history,
            "proxy_rollups": proxy_rollup_analytics,
            "proxy_costs": proxy_cost_analytics,
            "proxy_efficiency": {
                "last_7_days": proxy_efficiency_7d,
                "last_30_days": proxy_efficiency_30d,
                "trends": proxy_efficiency_trends,
                "alert_history": proxy_alert_snapshots,
            },
        },
        "users": [
            {
                "id": row.get("id"),
                "email": row.get("email"),
                "plan": row.get("plan", "free"),
                "role": row.get("role", "user"),
                "account_status": row.get("account_status", "active"),
                "downloads_today": row.get("downloads_today", 0),
                "created_at": row.get("created_at"),
            }
            for row in profiles[:100]
        ],
        "keys": owner_keys,
        "key_failure_alerts": key_failure_alerts,
    }


def _classify_key_failure_severity(*, total_requests: int, failure_rate_pct: float, throttle_hits: int, auth_hits: int, server_hits: int) -> str | None:
    if total_requests <= 0:
        return None
    if throttle_hits >= 5 or auth_hits >= 5 or (failure_rate_pct >= 80 and total_requests >= 10):
        return "critical"
    if server_hits >= 5 or (failure_rate_pct >= 50 and total_requests >= 8):
        return "high"
    if failure_rate_pct >= 25 and total_requests >= 5:
        return "medium"
    return None


def _recommended_key_action(*, severity: str | None, throttle_hits: int, auth_hits: int, failed_requests: int) -> str | None:
    if not severity:
        return None
    if severity == "critical" and (throttle_hits >= 5 or auth_hits >= 5 or failed_requests >= 20):
        return "suspend_user"
    return "throttle_key"


async def _build_api_key_failure_alerts(keys: list[dict[str, Any]], *, limit: int = 20) -> dict[str, Any]:
    alerts: list[dict[str, Any]] = []
    severity_counts = {"critical": 0, "high": 0, "medium": 0}
    source = "logs_only"

    for entry in keys:
        key_id = str(entry.get("id") or "").strip()
        if not key_id:
            continue
        usage = await summarize_api_key_usage(key_id, days=7, limit=250)
        source = usage.get("source") or source
        total_requests = int(usage.get("events_total") or 0)
        failed_requests = int(usage.get("failed_requests") or 0)
        if total_requests <= 0 or failed_requests <= 0:
            continue

        response_codes = usage.get("response_code_counts") or {}
        throttle_hits = int(response_codes.get("429") or 0)
        auth_hits = int(response_codes.get("401") or 0) + int(response_codes.get("403") or 0)
        server_hits = sum(
            int(count or 0)
            for code, count in response_codes.items()
            if str(code).isdigit() and str(code).startswith("5")
        )
        failure_rate_pct = float(usage.get("failure_rate_pct") or 0.0)
        severity = _classify_key_failure_severity(
            total_requests=total_requests,
            failure_rate_pct=failure_rate_pct,
            throttle_hits=throttle_hits,
            auth_hits=auth_hits,
            server_hits=server_hits,
        )
        if not severity:
            continue

        severity_counts[severity] += 1
        recent_requests = usage.get("recent_requests") or []
        latest_request = recent_requests[0] if recent_requests else {}
        alerts.append(
            {
                "key_id": key_id,
                "user_id": entry.get("user_id"),
                "key_name": entry.get("name") or "Production Key",
                "key_prefix": entry.get("key_prefix"),
                "status": entry.get("status", "unknown"),
                "plan_tier": entry.get("plan_tier"),
                "current_rate_limit": entry.get("rate_limit"),
                "severity": severity,
                "recommended_action": _recommended_key_action(
                    severity=severity,
                    throttle_hits=throttle_hits,
                    auth_hits=auth_hits,
                    failed_requests=failed_requests,
                ),
                "failure_rate_pct": failure_rate_pct,
                "failed_requests": failed_requests,
                "success_requests": int(usage.get("success_requests") or 0),
                "events_total": total_requests,
                "response_code_counts": response_codes,
                "response_code_family_counts": usage.get("response_code_family_counts") or {},
                "recent_endpoint": latest_request.get("endpoint"),
                "recent_provider": latest_request.get("provider"),
                "recent_response_code": latest_request.get("response_code"),
                "recent_last_ip": latest_request.get("last_ip"),
                "recent_at": latest_request.get("created_at"),
                "throttle_hits": throttle_hits,
                "auth_hits": auth_hits,
                "server_hits": server_hits,
                "usage_source": usage.get("source"),
            }
        )

    order = {"critical": 0, "high": 1, "medium": 2}
    alerts.sort(
        key=lambda row: (
            order.get(str(row.get("severity") or ""), 99),
            -float(row.get("failure_rate_pct") or 0.0),
            -int(row.get("failed_requests") or 0),
        )
    )
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "flagged_total": len(alerts),
        "critical_total": severity_counts["critical"],
        "high_total": severity_counts["high"],
        "medium_total": severity_counts["medium"],
        "alerts": alerts[:limit],
    }


def _abuse_event_weight(event_type: str) -> int:
    normalized = str(event_type or "unknown").lower()
    if "suspend" in normalized or "blacklist" in normalized:
        return 100
    if "throttle" in normalized or "rate_limit" in normalized:
        return 28
    if "auth" in normalized or "invalid" in normalized:
        return 18
    if "owner_" in normalized:
        return 10
    if "proxy" in normalized or "burn" in normalized:
        return 12
    if "referral" in normalized:
        return 6
    return 8


def _classify_abuse_severity(score: int, *, account_status: str, event_count: int) -> str | None:
    normalized_status = str(account_status or "active").lower()
    if normalized_status in {"suspended", "restricted"}:
        return "critical"
    if score >= 120 or event_count >= 10:
        return "critical"
    if score >= 70 or event_count >= 6:
        return "high"
    if score >= 28 or event_count >= 3:
        return "medium"
    return None


def _recommended_abuse_action(*, severity: str | None, account_status: str, has_key_alert: bool) -> str:
    normalized_status = str(account_status or "active").lower()
    if normalized_status in {"suspended", "restricted"}:
        return "monitor_restricted"
    if severity == "critical":
        return "suspend_user"
    if severity == "high":
        return "throttle_key" if has_key_alert else "inspect_user"
    if severity == "medium":
        return "inspect_user"
    return "observe"


async def _build_abuse_posture(*, limit: int = 500) -> dict[str, Any]:
    abuse_rows = await _fetch_table_rows("abuse_events", limit=limit)
    profiles = await _fetch_profiles(limit=200)
    profile_map = {str(row.get("id") or ""): row for row in profiles if row.get("id")}
    keys = await list_all_api_keys(limit=200)
    key_map = {str(row.get("id") or ""): row for row in keys if row.get("id")}
    key_alerts = await _build_api_key_failure_alerts(keys, limit=50)

    user_scores: dict[str, dict[str, Any]] = {}
    key_scores: dict[str, dict[str, Any]] = {}
    severity_counts = {"critical": 0, "high": 0, "medium": 0}

    for row in abuse_rows:
        user_id = str(row.get("user_id") or "").strip()
        api_key_id = str(row.get("api_key_id") or "").strip()
        event_type = str(row.get("event_type") or "unknown").lower()
        score_delta = _abuse_event_weight(event_type)
        if user_id:
            profile = profile_map.get(user_id) or {}
            current = user_scores.setdefault(
                user_id,
                {
                    "user_id": user_id,
                    "email": profile.get("email"),
                    "plan": profile.get("plan", "free"),
                    "account_status": profile.get("account_status", "active"),
                    "score": 0,
                    "event_count": 0,
                    "event_types": {},
                    "recent_events": [],
                    "has_key_alert": False,
                },
            )
            current["score"] += score_delta
            current["event_count"] += 1
            current["event_types"][event_type] = current["event_types"].get(event_type, 0) + 1
            if len(current["recent_events"]) < 5:
                current["recent_events"].append(
                    {
                        "event_type": event_type,
                        "detail": row.get("detail"),
                        "created_at": row.get("created_at"),
                        "api_key_id": row.get("api_key_id"),
                    }
                )
        if api_key_id:
            key_entry = key_map.get(api_key_id) or {}
            key_current = key_scores.setdefault(
                api_key_id,
                {
                    "key_id": api_key_id,
                    "user_id": key_entry.get("user_id"),
                    "key_prefix": key_entry.get("key_prefix"),
                    "name": key_entry.get("name"),
                    "score": 0,
                    "event_count": 0,
                    "event_types": {},
                },
            )
            key_current["score"] += score_delta
            key_current["event_count"] += 1
            key_current["event_types"][event_type] = key_current["event_types"].get(event_type, 0) + 1

    for alert in key_alerts.get("alerts") or []:
        user_id = str(alert.get("user_id") or "").strip()
        key_id = str(alert.get("key_id") or "").strip()
        severity = str(alert.get("severity") or "medium").lower()
        score_delta = {"medium": 25, "high": 45, "critical": 70}.get(severity, 20)
        if user_id:
            profile = profile_map.get(user_id) or {}
            current = user_scores.setdefault(
                user_id,
                {
                    "user_id": user_id,
                    "email": profile.get("email"),
                    "plan": profile.get("plan", "free"),
                    "account_status": profile.get("account_status", "active"),
                    "score": 0,
                    "event_count": 0,
                    "event_types": {},
                    "recent_events": [],
                    "has_key_alert": True,
                },
            )
            current["score"] += score_delta
            current["has_key_alert"] = True
            current["key_alert"] = {
                "key_id": key_id,
                "severity": severity,
                "failure_rate_pct": alert.get("failure_rate_pct"),
                "failed_requests": alert.get("failed_requests"),
            }
        if key_id:
            key_entry = key_map.get(key_id) or {}
            key_current = key_scores.setdefault(
                key_id,
                {
                    "key_id": key_id,
                    "user_id": key_entry.get("user_id"),
                    "key_prefix": key_entry.get("key_prefix"),
                    "name": key_entry.get("name"),
                    "score": 0,
                    "event_count": 0,
                    "event_types": {},
                },
            )
            key_current["score"] += score_delta
            key_current["failure_rate_pct"] = alert.get("failure_rate_pct")
            key_current["failed_requests"] = alert.get("failed_requests")
            key_current["recommended_action"] = alert.get("recommended_action")
            key_current["severity"] = severity

    flagged_users: list[dict[str, Any]] = []
    for current in user_scores.values():
        severity = _classify_abuse_severity(
            int(current.get("score") or 0),
            account_status=str(current.get("account_status") or "active"),
            event_count=int(current.get("event_count") or 0),
        )
        if not severity:
            continue
        severity_counts[severity] = severity_counts.get(severity, 0) + 1
        flagged_users.append(
            {
                **current,
                "severity": severity,
                "recommended_action": _recommended_abuse_action(
                    severity=severity,
                    account_status=str(current.get("account_status") or "active"),
                    has_key_alert=bool(current.get("has_key_alert")),
                ),
            }
        )

    flagged_users.sort(
        key=lambda item: (
            {"critical": 0, "high": 1, "medium": 2}.get(str(item.get("severity") or "medium"), 3),
            -int(item.get("score") or 0),
            -int(item.get("event_count") or 0),
        )
    )

    flagged_keys: list[dict[str, Any]] = []
    for current in key_scores.values():
        severity = current.get("severity") or _classify_key_failure_severity(
            total_requests=max(int(current.get("event_count") or 0), 1),
            failure_rate_pct=float(current.get("failure_rate_pct") or 0.0),
            throttle_hits=int(current.get("event_types", {}).get("throttle", 0)),
            auth_hits=int(current.get("event_types", {}).get("auth", 0)),
            server_hits=int(current.get("event_types", {}).get("server_error", 0)),
        )
        if not severity:
            continue
        flagged_keys.append(
            {
                **current,
                "severity": severity,
                "recommended_action": current.get("recommended_action") or _recommended_key_action(
                    severity=severity,
                    throttle_hits=int(current.get("event_types", {}).get("throttle", 0)),
                    auth_hits=int(current.get("event_types", {}).get("auth", 0)),
                    failed_requests=int(current.get("failed_requests") or 0),
                ),
            }
        )

    flagged_keys.sort(
        key=lambda item: (
            {"critical": 0, "high": 1, "medium": 2}.get(str(item.get("severity") or "medium"), 3),
            -int(item.get("score") or 0),
        )
    )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "abuse_events+key_alerts",
        "events_total": len(abuse_rows),
        "flagged_users_total": len(flagged_users),
        "flagged_keys_total": len(flagged_keys),
        "severity_counts": severity_counts,
        "flagged_users": flagged_users[:12],
        "flagged_keys": flagged_keys[:12],
    }


async def _fetch_profile(user_id: str) -> dict[str, Any] | None:
    if not supabase:
        return None

    def _query():
        try:
            result = supabase.table("profiles").select("*").eq("id", user_id).maybe_single().execute()
            return result.data or None
        except Exception:
            return None

    return await asyncio.to_thread(_query)


async def _write_profile_status(user_id: str, status: str) -> None:
    if not supabase:
        return

    def _query():
        try:
            supabase.table("profiles").update({"account_status": status}).eq("id", user_id).execute()
        except Exception:
            return None

    await asyncio.to_thread(_query)


async def _write_profile_fields(user_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    if not supabase:
        return None

    payload = {key: value for key, value in fields.items() if value is not None}
    if not payload:
        return await _fetch_profile(user_id)

    def _query():
        try:
            result = supabase.table("profiles").update(payload).eq("id", user_id).execute()
            if result.data:
                return result.data[0]
            return None
        except Exception:
            return None

    updated = await asyncio.to_thread(_query)
    return updated or await _fetch_profile(user_id)


async def _clear_user_usage_buffers(user_id: str) -> None:
    try:
        redis_client = await ensure_redis_or_fail()
        await redis_client.delete(
            f"usage_buffer:{user_id}",
            f"download_usage_buffer:{user_id}",
            f"api_usage_daily:{user_id}",
        )
    except Exception:
        return


async def _fetch_user_jobs(user_id: str, limit: int = 10) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        try:
            result = (
                supabase.table("jobs")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    return await asyncio.to_thread(_query)


async def _build_enterprise_key_snapshot(key_row: dict[str, Any]) -> dict[str, Any]:
    override = await get_api_key_override(str(key_row.get("id") or ""))
    plan_tier = str(
        (override or {}).get("plan_tier_override")
        or key_row.get("plan_tier")
        or "api"
    ).strip().lower()
    entitlement = apply_api_key_override_to_entitlement(
        build_effective_entitlement({"plan": plan_tier, "role": "user", "anonymous": False}),
        override,
    )
    usage = await summarize_api_key_usage(str(key_row.get("id") or ""))
    return {
        "key": key_row,
        "override": override or {},
        "effective_policy": {
            "plan": plan_tier,
            "rate_limit": int(
                (override or {}).get("custom_rate_limit")
                or key_row.get("rate_limit")
                or get_default_rate_limit_for_plan(plan_tier)
            ),
            "daily_quota": int(entitlement.get("api_request_limit_daily") or 0),
            "max_concurrent_jobs": int(entitlement.get("max_concurrent_jobs") or 0),
            "retention_hours": int(entitlement.get("retention_hours") or 0),
            "queue_priority": entitlement.get("queue_priority"),
            "webhooks_enabled": bool((override or {}).get("webhooks_enabled", False)),
            "max_quality": int(entitlement.get("max_quality") or 0),
        },
        "usage": usage,
    }


async def _build_enterprise_account_snapshot(target_user_id: str) -> dict[str, Any]:
    profile = await _fetch_profile(target_user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found.")

    subscriptions = [
        row for row in await _fetch_subscriptions(limit=1000) if str(row.get("user_id") or "") == target_user_id
    ]
    subscription = subscriptions[0] if subscriptions else None
    user_keys = [row for row in await list_all_api_keys(limit=500) if str(row.get("user_id") or "") == target_user_id]
    key_snapshots = [await _build_enterprise_key_snapshot(row) for row in user_keys]
    total_quota = sum(int((entry.get("effective_policy") or {}).get("daily_quota") or 0) for entry in key_snapshots)
    total_rpm = sum(int((entry.get("effective_policy") or {}).get("rate_limit") or 0) for entry in key_snapshots)
    active_keys = sum(
        1 for entry in key_snapshots if str((entry.get("key") or {}).get("status") or "").lower() == "active"
    )
    webhook_ready_keys = sum(
        1 for entry in key_snapshots if bool((entry.get("effective_policy") or {}).get("webhooks_enabled"))
    )
    last_key_activity = [
        str((entry.get("key") or {}).get("last_used_at") or "")
        for entry in key_snapshots
        if (entry.get("key") or {}).get("last_used_at")
    ]
    return {
        "profile": profile,
        "subscription": subscription,
        "keys": key_snapshots,
        "summary": {
            "keys_total": len(key_snapshots),
            "active_keys": active_keys,
            "effective_daily_quota_total": total_quota,
            "effective_rate_limit_total": total_rpm,
            "webhook_ready_keys": webhook_ready_keys,
            "last_key_activity_at": max(last_key_activity) if last_key_activity else None,
        },
    }


async def _record_abuse_event(user_id: str, event_type: str, detail: str | None = None) -> None:
    if not supabase:
        return

    def _query():
        try:
            supabase.table("abuse_events").insert(
                {
                    "user_id": user_id,
                    "event_type": event_type,
                    "detail": detail,
                    "payload": {},
                }
            ).execute()
        except Exception:
            return None

    await asyncio.to_thread(_query)


async def _record_owner_audit_event(
    *,
    actor_user_id: str | None,
    action: str,
    target_type: str,
    target_id: str | None,
    detail: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    if not supabase:
        return

    audit_payload = {
        "actor_user_id": actor_user_id,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "detail": detail,
        "payload": payload or {},
    }

    def _query():
        global OWNER_AUDIT_SOURCE_HINT
        primary_table = "audit_logs" if OWNER_AUDIT_SOURCE_HINT == "audit_logs" else "abuse_events"
        fallback_table = "abuse_events" if primary_table == "audit_logs" else "audit_logs"

        def _write(table_name: str) -> bool:
            try:
                if table_name == "audit_logs":
                    supabase.table("audit_logs").insert(audit_payload).execute()
                else:
                    supabase.table("abuse_events").insert(
                        {
                            "user_id": target_id if target_type == "user" else actor_user_id,
                            "event_type": f"owner_audit:{action}",
                            "detail": detail,
                            "payload": audit_payload,
                        }
                    ).execute()
                return True
            except Exception:
                return False

        if _write(primary_table):
            OWNER_AUDIT_SOURCE_HINT = primary_table
            return
        if _write(fallback_table):
            OWNER_AUDIT_SOURCE_HINT = fallback_table
            return
        return None

    await asyncio.to_thread(_query)


async def _fetch_owner_audit_events(limit: int = 200) -> list[dict[str, Any]]:
    if not supabase:
        return []

    def _query():
        global OWNER_AUDIT_SOURCE_HINT
        primary_table = "audit_logs" if OWNER_AUDIT_SOURCE_HINT == "audit_logs" else "abuse_events"
        fallback_table = "abuse_events" if primary_table == "audit_logs" else "audit_logs"

        def _normalize(table_name: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
            if table_name == "audit_logs":
                return rows

            normalized = []
            for row in rows:
                event_type = str(row.get("event_type") or "")
                if not event_type.startswith("owner_audit:"):
                    continue
                payload = row.get("payload") or {}
                normalized.append(
                    {
                        "id": row.get("id"),
                        "actor_user_id": payload.get("actor_user_id"),
                        "action": payload.get("action") or event_type.replace("owner_audit:", ""),
                        "target_type": payload.get("target_type") or "unknown",
                        "target_id": payload.get("target_id"),
                        "detail": row.get("detail") or payload.get("detail"),
                        "payload": payload.get("payload") or {},
                        "created_at": row.get("created_at"),
                    }
                )
            return normalized

        def _fetch(table_name: str) -> list[dict[str, Any]]:
            if table_name == "audit_logs":
                result = (
                    supabase.table("audit_logs")
                    .select("*")
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                )
            else:
                result = (
                    supabase.table("abuse_events")
                    .select("*")
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                )
            return result.data or []

        try:
            rows = _fetch(primary_table)
            OWNER_AUDIT_SOURCE_HINT = primary_table
            return _normalize(primary_table, rows)
        except Exception:
            pass

        try:
            fallback_rows = _fetch(fallback_table)
            OWNER_AUDIT_SOURCE_HINT = fallback_table
            return _normalize(fallback_table, fallback_rows)
        except Exception:
            return []

    return await asyncio.to_thread(_query)


def _build_audit_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    action_counts: dict[str, int] = {}
    target_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}
    recent_events: list[dict[str, Any]] = []

    for row in rows:
        action = str(row.get("action") or "unknown").lower()
        target_type = str(row.get("target_type") or "unknown").lower()
        created_at = str(row.get("created_at") or "")
        action_counts[action] = action_counts.get(action, 0) + 1
        target_counts[target_type] = target_counts.get(target_type, 0) + 1
        if created_at:
            daily_key = created_at[:10]
            daily_counts[daily_key] = daily_counts.get(daily_key, 0) + 1
        if len(recent_events) < 25:
            recent_events.append(
                {
                    "id": row.get("id"),
                    "actor_user_id": row.get("actor_user_id"),
                    "action": row.get("action"),
                    "target_type": row.get("target_type"),
                    "target_id": row.get("target_id"),
                    "detail": row.get("detail"),
                    "created_at": row.get("created_at"),
                }
            )

    return {
        "events_total": len(rows),
        "action_counts": action_counts,
        "target_counts": target_counts,
        "daily_counts": daily_counts,
        "recent_events": recent_events,
    }


def _build_abuse_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    event_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}
    affected_users = 0
    unique_users: set[str] = set()
    recent_events: list[dict[str, Any]] = []

    for row in rows:
        event_type = str(row.get("event_type") or "unknown").lower()
        created_at = str(row.get("created_at") or "")
        user_id = str(row.get("user_id") or "")
        event_counts[event_type] = event_counts.get(event_type, 0) + 1
        if created_at:
            daily_key = created_at[:10]
            daily_counts[daily_key] = daily_counts.get(daily_key, 0) + 1
        if user_id:
            unique_users.add(user_id)
        if len(recent_events) < 25:
            recent_events.append(
                {
                    "id": row.get("id"),
                    "user_id": row.get("user_id"),
                    "api_key_id": row.get("api_key_id"),
                    "event_type": row.get("event_type"),
                    "detail": row.get("detail"),
                    "created_at": row.get("created_at"),
                }
            )

    affected_users = len(unique_users)
    return {
        "events_total": len(rows),
        "event_counts": event_counts,
        "daily_counts": daily_counts,
        "affected_users": affected_users,
        "recent_events": recent_events,
    }


def _build_proxy_history_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    event_counts: dict[str, int] = {}
    provider_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}
    burn_events = 0
    recent_events: list[dict[str, Any]] = []

    for row in rows:
        event_type = str(row.get("event_type") or "unknown").lower()
        provider = str(row.get("provider") or "unknown").lower()
        created_at = str(row.get("created_at") or "")
        event_counts[event_type] = event_counts.get(event_type, 0) + 1
        provider_counts[provider] = provider_counts.get(provider, 0) + 1
        if event_type == "burn":
            burn_events += 1
        if created_at:
            daily_key = created_at[:10]
            daily_counts[daily_key] = daily_counts.get(daily_key, 0) + 1
        if len(recent_events) < 20:
            recent_events.append(
                {
                    "id": row.get("id"),
                    "event_type": row.get("event_type"),
                    "provider": row.get("provider"),
                    "reason": row.get("reason"),
                    "created_at": row.get("created_at"),
                }
            )

    return {
        "events_total": len(rows),
        "burn_events": burn_events,
        "event_counts": event_counts,
        "provider_counts": provider_counts,
        "daily_counts": daily_counts,
        "recent_events": recent_events,
    }


def _build_proxy_alert_history_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    alert_type_counts: dict[str, int] = {}
    provider_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}
    total_events = 0
    recent_events: list[dict[str, Any]] = []

    for row in rows:
        alert_type = str(row.get("alert_type") or "unknown").lower()
        provider_name = str(row.get("provider_name") or "unknown").lower()
        created_at = str(row.get("created_at") or "")
        day = created_at[:10] if created_at else ""

        total_events += 1
        alert_type_counts[alert_type] = alert_type_counts.get(alert_type, 0) + 1
        provider_counts[provider_name] = provider_counts.get(provider_name, 0) + 1
        if day:
            daily_counts[day] = daily_counts.get(day, 0) + 1

        if len(recent_events) < 20:
            recent_events.append(
                {
                    "id": row.get("id"),
                    "alert_type": row.get("alert_type"),
                    "provider_name": row.get("provider_name"),
                    "total_probes": row.get("total_probes"),
                    "success_rate_pct": row.get("success_rate_pct"),
                    "burn_rate_per_1k": row.get("burn_rate_per_1k"),
                    "reason_text": row.get("reason_text"),
                    "created_at": row.get("created_at"),
                }
            )

    return {
        "events_total": total_events,
        "alert_type_counts": alert_type_counts,
        "provider_counts": provider_counts,
        "daily_counts": daily_counts,
        "recent_events": recent_events,
        "source": "table" if rows else "table_empty",
    }


def _build_proxy_alert_rollup_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str, str], dict[str, Any]] = {}
    now_iso = datetime.now(timezone.utc).isoformat()

    for row in rows:
        created_at = str(row.get("created_at") or "")
        day = created_at[:10] if created_at else datetime.now(timezone.utc).date().isoformat()
        alert_type = str(row.get("alert_type") or "unknown").lower()
        provider_name = str(row.get("provider_name") or "unknown").lower()
        key = (day, alert_type, provider_name)
        current = buckets.get(key)
        if current is None:
            current = {
                "day": day,
                "alert_type": alert_type,
                "provider_name": provider_name,
                "event_count": 0,
                "updated_at": now_iso,
            }
            buckets[key] = current
        current["event_count"] += 1

    return list(buckets.values())


def _build_proxy_alert_history_analytics_from_rollups(
    rows: list[dict[str, Any]],
    *,
    recent_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    alert_type_counts: dict[str, int] = {}
    provider_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}
    total_events = 0

    for row in rows:
        day = str(row.get("day") or "")
        alert_type = str(row.get("alert_type") or "unknown").lower()
        provider_name = str(row.get("provider_name") or "unknown").lower()
        event_count = int(row.get("event_count") or 0)

        total_events += event_count
        alert_type_counts[alert_type] = alert_type_counts.get(alert_type, 0) + event_count
        provider_counts[provider_name] = provider_counts.get(provider_name, 0) + event_count
        if day:
            daily_counts[day] = daily_counts.get(day, 0) + event_count

    recent_events: list[dict[str, Any]] = []
    for row in (recent_rows or [])[:20]:
        recent_events.append(
            {
                "id": row.get("id"),
                "alert_type": row.get("alert_type"),
                "provider_name": row.get("provider_name"),
                "total_probes": row.get("total_probes"),
                "success_rate_pct": row.get("success_rate_pct"),
                "burn_rate_per_1k": row.get("burn_rate_per_1k"),
                "reason_text": row.get("reason_text"),
                "created_at": row.get("created_at"),
            }
        )

    return {
        "events_total": total_events,
        "alert_type_counts": alert_type_counts,
        "provider_counts": provider_counts,
        "daily_counts": daily_counts,
        "recent_events": recent_events,
        "rollup_rows": len(rows),
        "source": "rollup" if rows else "rollup_empty",
    }


def _build_proxy_breaker_posture(proxy_telemetry: dict[str, Any], breaker_history: dict[str, Any]) -> dict[str, Any]:
    auto_paused_states = dict(proxy_telemetry.get("auto_paused_provider_states") or {})
    escalation_counts: dict[str, int] = {}
    recurring_offenders: list[dict[str, Any]] = []
    quarantined_providers: list[dict[str, Any]] = []

    for provider_name, entry in auto_paused_states.items():
        escalation_level = str(entry.get("escalation_level") or "normal").lower()
        escalation_counts[escalation_level] = escalation_counts.get(escalation_level, 0) + 1
        offender = {
            "provider_name": provider_name,
            "escalation_level": escalation_level,
            "trip_count_with_current": int(entry.get("trip_count_with_current") or 0),
            "recent_breaker_trips_in_window": int(entry.get("recent_breaker_trips_in_window") or 0),
            "trip_window_hours": int(entry.get("trip_window_hours") or 0),
            "next_health_check_at": entry.get("next_health_check_at"),
            "quarantine_until": entry.get("quarantine_until"),
            "last_reason": entry.get("last_reason"),
            "recovery_status": entry.get("recovery_status"),
        }
        if offender["trip_count_with_current"] >= 2:
            recurring_offenders.append(offender)
        if bool(entry.get("hard_quarantine")) or escalation_level == "quarantined":
            quarantined_providers.append(offender)

    recurring_offenders.sort(
        key=lambda item: (
            -int(item.get("trip_count_with_current") or 0),
            -int(item.get("recent_breaker_trips_in_window") or 0),
            str(item.get("provider_name") or ""),
        )
    )
    quarantined_providers.sort(key=lambda item: str(item.get("provider_name") or ""))

    return {
        "escalation_counts": escalation_counts,
        "recurring_offenders": recurring_offenders[:10],
        "quarantined_providers": quarantined_providers[:10],
        "total_recurring_offenders": len(recurring_offenders),
        "total_quarantined": len(quarantined_providers),
        "history_events_total": int(breaker_history.get("events_total") or 0),
    }


def _build_proxy_quarantine_export_rows(
    proxy_breaker_posture: dict[str, Any],
    proxy_breaker_history: dict[str, Any],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    history_provider_counts = dict(proxy_breaker_history.get("provider_counts") or {})
    escalation_counts = dict(proxy_breaker_posture.get("escalation_counts") or {})
    recurring_map = {
        str(entry.get("provider_name") or "").lower(): entry
        for entry in (proxy_breaker_posture.get("recurring_offenders") or [])
    }
    quarantined_map = {
        str(entry.get("provider_name") or "").lower(): entry
        for entry in (proxy_breaker_posture.get("quarantined_providers") or [])
    }

    provider_names = sorted(set(recurring_map) | set(quarantined_map))
    generated_at = datetime.now(timezone.utc).isoformat()

    for provider_name in provider_names:
        recurring = recurring_map.get(provider_name) or {}
        quarantined = quarantined_map.get(provider_name) or recurring
        rows.append(
            {
                "generated_at": generated_at,
                "provider_name": provider_name,
                "is_recurring_offender": provider_name in recurring_map,
                "is_quarantined": provider_name in quarantined_map,
                "escalation_level": quarantined.get("escalation_level") or recurring.get("escalation_level") or "normal",
                "recovery_status": quarantined.get("recovery_status") or recurring.get("recovery_status") or "unknown",
                "trip_count_with_current": int(quarantined.get("trip_count_with_current") or recurring.get("trip_count_with_current") or 0),
                "recent_breaker_trips_in_window": int(
                    quarantined.get("recent_breaker_trips_in_window") or recurring.get("recent_breaker_trips_in_window") or 0
                ),
                "trip_window_hours": int(quarantined.get("trip_window_hours") or recurring.get("trip_window_hours") or 0),
                "quarantine_until": quarantined.get("quarantine_until"),
                "next_health_check_at": quarantined.get("next_health_check_at") or recurring.get("next_health_check_at"),
                "last_reason": quarantined.get("last_reason") or recurring.get("last_reason"),
                "history_events_total_for_provider": int(history_provider_counts.get(provider_name) or 0),
                "history_events_total_global": int(proxy_breaker_history.get("events_total") or 0),
                "recurring_offenders_total": int(proxy_breaker_posture.get("total_recurring_offenders") or 0),
                "quarantined_total": int(proxy_breaker_posture.get("total_quarantined") or 0),
                "escalation_counts": json.dumps(escalation_counts, separators=(",", ":"), sort_keys=True),
            }
        )

    return rows


def _build_proxy_breaker_posture_rollup_row(proxy_breaker_posture: dict[str, Any]) -> dict[str, Any]:
    escalation_counts = dict(proxy_breaker_posture.get("escalation_counts") or {})
    now = datetime.now(timezone.utc)
    return {
        "day": now.date().isoformat(),
        "total_recurring_offenders": int(proxy_breaker_posture.get("total_recurring_offenders") or 0),
        "total_quarantined": int(proxy_breaker_posture.get("total_quarantined") or 0),
        "normal_providers": int(escalation_counts.get("normal") or 0),
        "elevated_providers": int(escalation_counts.get("elevated") or 0),
        "severe_providers": int(escalation_counts.get("severe") or 0),
        "quarantined_providers": int(escalation_counts.get("quarantined") or 0),
        "updated_at": now.isoformat(),
    }


def _build_proxy_breaker_posture_history_from_rollups(rows: list[dict[str, Any]]) -> dict[str, Any]:
    daily_recurring_counts: dict[str, int] = {}
    daily_quarantine_counts: dict[str, int] = {}
    escalation_trend: dict[str, dict[str, int]] = {}
    recent_rows: list[dict[str, Any]] = []

    for row in rows:
        day = str(row.get("day") or "")
        if not day:
            continue
        daily_recurring_counts[day] = int(row.get("total_recurring_offenders") or 0)
        daily_quarantine_counts[day] = int(row.get("total_quarantined") or 0)
        escalation_trend[day] = {
            "normal": int(row.get("normal_providers") or 0),
            "elevated": int(row.get("elevated_providers") or 0),
            "severe": int(row.get("severe_providers") or 0),
            "quarantined": int(row.get("quarantined_providers") or 0),
        }
        if len(recent_rows) < 14:
            recent_rows.append(
                {
                    "day": day,
                    "total_recurring_offenders": int(row.get("total_recurring_offenders") or 0),
                    "total_quarantined": int(row.get("total_quarantined") or 0),
                    "normal_providers": int(row.get("normal_providers") or 0),
                    "elevated_providers": int(row.get("elevated_providers") or 0),
                    "severe_providers": int(row.get("severe_providers") or 0),
                    "quarantined_providers": int(row.get("quarantined_providers") or 0),
                    "updated_at": row.get("updated_at"),
                }
            )

    latest = recent_rows[0] if recent_rows else None
    return {
        "rows_total": len(rows),
        "daily_recurring_counts": daily_recurring_counts,
        "daily_quarantine_counts": daily_quarantine_counts,
        "escalation_trend": escalation_trend,
        "recent_rows": recent_rows,
        "latest": latest,
        "source": "rollup" if rows else "rollup_empty",
    }


def _build_proxy_rollup_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    provider_counts: dict[str, int] = {}
    success_counts: dict[str, int] = {}
    failure_counts: dict[str, int] = {}
    burn_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}
    total_probes = 0
    successes = 0
    failures = 0
    burn_events = 0
    estimated_total_cost = 0.0
    recent_rows: list[dict[str, Any]] = []

    for row in rows:
        provider = str(row.get("provider_name") or "unknown").lower()
        rollup_date = str(row.get("rollup_date") or "")
        provider_total = int(row.get("total_probes") or 0)
        provider_success = int(row.get("successful_probes") or 0)
        provider_failure = int(row.get("failed_probes") or 0)
        provider_burn = int(row.get("burn_events") or 0)
        provider_cost = float(row.get("estimated_cost_usd") or 0)

        provider_counts[provider] = provider_counts.get(provider, 0) + provider_total
        success_counts[provider] = success_counts.get(provider, 0) + provider_success
        failure_counts[provider] = failure_counts.get(provider, 0) + provider_failure
        burn_counts[provider] = burn_counts.get(provider, 0) + provider_burn
        if rollup_date:
            daily_counts[rollup_date] = daily_counts.get(rollup_date, 0) + provider_total

        total_probes += provider_total
        successes += provider_success
        failures += provider_failure
        burn_events += provider_burn
        estimated_total_cost += provider_cost

        if len(recent_rows) < 25:
            recent_rows.append(
                {
                    "id": row.get("id"),
                    "provider_name": provider,
                    "rollup_date": row.get("rollup_date"),
                    "total_probes": provider_total,
                    "successful_probes": provider_success,
                    "failed_probes": provider_failure,
                    "burn_events": provider_burn,
                    "estimated_cost_usd": round(provider_cost, 4),
                    "updated_at": row.get("updated_at"),
                }
            )

    return {
        "rows_total": len(rows),
        "total_probes": total_probes,
        "successful_probes": successes,
        "failed_probes": failures,
        "burn_events": burn_events,
        "estimated_total_cost": round(estimated_total_cost, 4),
        "provider_counts": provider_counts,
        "success_counts": success_counts,
        "failure_counts": failure_counts,
        "burn_counts": burn_counts,
        "daily_counts": daily_counts,
        "recent_rows": recent_rows,
    }


def _load_proxy_provider_costs() -> dict[str, float]:
    raw = os.environ.get("PROXY_PROVIDER_COSTS_JSON", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}

    normalized: dict[str, float] = {}
    for provider, value in parsed.items():
        try:
            normalized[str(provider).strip().lower()] = float(value)
        except (TypeError, ValueError):
            continue
    return normalized


def _build_proxy_cost_analytics(proxy_telemetry: dict[str, Any], proxy_history: dict[str, Any], proxy_rollups: dict[str, Any] | None = None) -> dict[str, Any]:
    default_cost_per_1000 = float(os.environ.get("PROXY_COST_PER_1000_PROBES", "0") or 0)
    provider_cost_overrides = _load_proxy_provider_costs()

    rollup_source = proxy_rollups or {}
    total_probes = int(rollup_source.get("total_probes") or proxy_telemetry.get("total_probes") or 0)
    proxied_probes = int(proxy_telemetry.get("proxied_probes") or 0)
    successes = int(rollup_source.get("successful_probes") or proxy_telemetry.get("successes") or 0)
    failures = int(rollup_source.get("failed_probes") or proxy_telemetry.get("failures") or 0)
    burn_events = int(rollup_source.get("burn_events") or proxy_telemetry.get("burn_events") or 0)

    provider_probe_counts = dict(rollup_source.get("provider_counts") or proxy_telemetry.get("provider_counts") or {})
    provider_burn_counts = dict(rollup_source.get("burn_counts") or proxy_history.get("provider_counts") or {})
    provider_cost_per_1000: dict[str, float] = {}
    provider_cost_estimates: dict[str, float] = {}
    estimated_total_cost = float(rollup_source.get("estimated_total_cost") or 0)
    provider_cost_seeded = bool(rollup_source.get("estimated_total_cost"))
    for provider, count in provider_probe_counts.items():
        provider_key = str(provider).strip().lower()
        provider_cost = provider_cost_overrides.get(provider_key, default_cost_per_1000)
        provider_cost_per_1000[provider_key] = round(provider_cost, 4)
        provider_estimate = round((int(count or 0) * (provider_cost / 1000 if provider_cost else 0.0)), 4)
        provider_cost_estimates[provider_key] = provider_estimate
        if not provider_cost_seeded:
            estimated_total_cost += provider_estimate

    success_rate = round((successes / total_probes) * 100, 2) if total_probes else 0.0
    proxy_usage_rate = round((proxied_probes / total_probes) * 100, 2) if total_probes else 0.0
    burn_rate_per_1000 = round((burn_events / proxied_probes) * 1000, 2) if proxied_probes else 0.0
    cost_per_successful_probe = round((estimated_total_cost / successes), 4) if successes else 0.0
    cost_per_burn_event = round((estimated_total_cost / burn_events), 4) if burn_events else 0.0

    return {
        "cost_per_1000_probes": round(default_cost_per_1000, 4),
        "provider_cost_per_1000": provider_cost_per_1000,
        "estimated_total_cost": round(estimated_total_cost, 4),
        "source": "daily_rollups" if rollup_source.get("rows_total") else "live_telemetry",
        "total_probes": total_probes,
        "proxied_probes": proxied_probes,
        "success_rate": success_rate,
        "proxy_usage_rate": proxy_usage_rate,
        "burn_rate_per_1000_probes": burn_rate_per_1000,
        "cost_per_successful_probe": cost_per_successful_probe,
        "cost_per_burn_event": cost_per_burn_event,
        "provider_probe_counts": provider_probe_counts,
        "provider_burn_counts": provider_burn_counts,
        "provider_cost_estimates": provider_cost_estimates,
        "successes": successes,
        "failures": failures,
    }


def _build_proxy_efficiency_metrics(rows: list[dict[str, Any]], *, window_days: int) -> dict[str, Any]:
    providers: list[dict[str, Any]] = []

    for row in rows:
        provider_name = str(row.get("provider_name") or "unknown").lower()
        total_probes = int(row.get("sum_total_probes") or 0)
        successful_probes = int(row.get("sum_successful_probes") or 0)
        burn_events = int(row.get("sum_burn_events") or 0)
        estimated_cost_usd = round(float(row.get("sum_estimated_cost_usd") or 0), 4)

        success_rate_pct = round((successful_probes / total_probes) * 100, 2) if total_probes else 0.0
        burn_rate_per_1k = round((burn_events / total_probes) * 1000, 2) if total_probes else 0.0
        cost_per_success_usd = round((estimated_cost_usd / successful_probes), 4) if successful_probes else 0.0

        providers.append(
            {
                "provider_name": provider_name,
                "total_probes": total_probes,
                "successful_probes": successful_probes,
                "burn_events": burn_events,
                "estimated_cost_usd": estimated_cost_usd,
                "success_rate_pct": success_rate_pct,
                "burn_rate_per_1k": burn_rate_per_1k,
                "cost_per_success_usd": cost_per_success_usd,
            }
        )

    providers.sort(key=lambda item: (item["cost_per_success_usd"], -item["successful_probes"], item["provider_name"]))

    return {
        "window_days": window_days,
        "providers": providers,
        "source": "native_aggregate",
    }


def _load_proxy_alert_thresholds() -> dict[str, float]:
    return {
        "min_total_probes_7d": float(os.environ.get("PROXY_ALERT_MIN_TOTAL_PROBES_7D", "20") or 20),
        "min_success_rate_pct": float(os.environ.get("PROXY_ALERT_MIN_SUCCESS_RATE_PCT", "85") or 85),
        "max_burn_rate_per_1k": float(os.environ.get("PROXY_ALERT_MAX_BURN_RATE_PER_1K", "50") or 50),
        "max_cost_per_success_usd": float(os.environ.get("PROXY_ALERT_MAX_COST_PER_SUCCESS_USD", "0.25") or 0.25),
        "max_success_rate_drop_pct_points": float(os.environ.get("PROXY_ALERT_MAX_SUCCESS_RATE_DROP_PCT_POINTS", "8") or 8),
        "max_burn_rate_increase_per_1k": float(os.environ.get("PROXY_ALERT_MAX_BURN_RATE_INCREASE_PER_1K", "20") or 20),
        "max_cost_per_success_increase_usd": float(os.environ.get("PROXY_ALERT_MAX_COST_PER_SUCCESS_INCREASE_USD", "0.05") or 0.05),
    }


def _build_proxy_efficiency_trends(last_7_days: dict[str, Any], last_30_days: dict[str, Any]) -> dict[str, Any]:
    thresholds = _load_proxy_alert_thresholds()
    by_provider_30d = {
        str(entry.get("provider_name") or "unknown").lower(): entry
        for entry in (last_30_days.get("providers") or [])
    }

    providers: list[dict[str, Any]] = []
    alert_counts: dict[str, int] = {}
    alert_rows: list[dict[str, Any]] = []

    for entry_7d in last_7_days.get("providers") or []:
        provider_name = str(entry_7d.get("provider_name") or "unknown").lower()
        entry_30d = by_provider_30d.get(provider_name, {})
        total_probes_7d = int(entry_7d.get("total_probes") or 0)
        success_rate_7d = float(entry_7d.get("success_rate_pct") or 0)
        burn_rate_7d = float(entry_7d.get("burn_rate_per_1k") or 0)
        cost_per_success_7d = float(entry_7d.get("cost_per_success_usd") or 0)

        success_rate_30d = float(entry_30d.get("success_rate_pct") or 0)
        burn_rate_30d = float(entry_30d.get("burn_rate_per_1k") or 0)
        cost_per_success_30d = float(entry_30d.get("cost_per_success_usd") or 0)

        success_rate_delta_pct_points = round(success_rate_7d - success_rate_30d, 2)
        burn_rate_delta_per_1k = round(burn_rate_7d - burn_rate_30d, 2)
        cost_per_success_delta_usd = round(cost_per_success_7d - cost_per_success_30d, 4)

        alerts: list[str] = []
        if total_probes_7d >= thresholds["min_total_probes_7d"]:
            if success_rate_7d < thresholds["min_success_rate_pct"]:
                alerts.append("low_success_rate")
            if burn_rate_7d > thresholds["max_burn_rate_per_1k"]:
                alerts.append("high_burn_rate")
            if cost_per_success_7d > thresholds["max_cost_per_success_usd"]:
                alerts.append("high_cost_per_success")
            if success_rate_delta_pct_points < -thresholds["max_success_rate_drop_pct_points"]:
                alerts.append("success_rate_drop")
            if burn_rate_delta_per_1k > thresholds["max_burn_rate_increase_per_1k"]:
                alerts.append("burn_rate_increase")
            if cost_per_success_delta_usd > thresholds["max_cost_per_success_increase_usd"]:
                alerts.append("cost_increase")

        for alert_name in alerts:
            alert_counts[alert_name] = alert_counts.get(alert_name, 0) + 1

        provider_row = {
            "provider_name": provider_name,
            "total_probes_7d": total_probes_7d,
            "success_rate_pct_7d": success_rate_7d,
            "burn_rate_per_1k_7d": burn_rate_7d,
            "cost_per_success_usd_7d": cost_per_success_7d,
            "total_cost_usd_7d": float(entry_7d.get("estimated_cost_usd") or 0),
            "success_rate_pct_30d": success_rate_30d,
            "burn_rate_per_1k_30d": burn_rate_30d,
            "cost_per_success_usd_30d": cost_per_success_30d,
            "success_rate_delta_pct_points": success_rate_delta_pct_points,
            "burn_rate_delta_per_1k": burn_rate_delta_per_1k,
            "cost_per_success_delta_usd": cost_per_success_delta_usd,
            "alerts": alerts,
        }
        providers.append(provider_row)
        if alerts:
            alert_rows.append(provider_row)

    alert_rows.sort(key=lambda item: (-len(item["alerts"]), item["cost_per_success_usd_7d"], item["provider_name"]))

    return {
        "thresholds": thresholds,
        "providers": providers,
        "alert_counts": alert_counts,
        "alert_rows": alert_rows[:10],
    }


def _build_proxy_alert_snapshot_rows(trends: dict[str, Any]) -> list[dict[str, Any]]:
    snapshot_date = datetime.now(timezone.utc).date().isoformat()
    rows: list[dict[str, Any]] = []
    for entry in trends.get("providers") or []:
        alerts = set(entry.get("alerts") or [])
        rows.append(
            {
                "snapshot_date": snapshot_date,
                "provider_name": entry.get("provider_name") or "unknown",
                "total_probes_7d": int(entry.get("total_probes_7d") or 0),
                "success_rate_pct_7d": round(float(entry.get("success_rate_pct_7d") or 0), 2),
                "burn_rate_per_1k_7d": round(float(entry.get("burn_rate_per_1k_7d") or 0), 2),
                "cost_per_success_usd_7d": round(float(entry.get("cost_per_success_usd_7d") or 0), 4),
                "success_rate_pct_30d": round(float(entry.get("success_rate_pct_30d") or 0), 2),
                "burn_rate_per_1k_30d": round(float(entry.get("burn_rate_per_1k_30d") or 0), 2),
                "cost_per_success_usd_30d": round(float(entry.get("cost_per_success_usd_30d") or 0), 4),
                "alert_count": len(alerts),
                "low_success_rate": "low_success_rate" in alerts,
                "high_burn_rate": "high_burn_rate" in alerts,
                "high_cost_per_success": "high_cost_per_success" in alerts,
                "success_rate_drop": "success_rate_drop" in alerts,
                "burn_rate_increase": "burn_rate_increase" in alerts,
                "cost_increase": "cost_increase" in alerts,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    return rows


async def _persist_proxy_alert_snapshots(rows: list[dict[str, Any]]) -> bool:
    if not supabase:
        return False
    if not rows:
        return True

    def _query() -> bool:
        try:
            supabase.table("proxy_alert_snapshots_daily").upsert(rows).execute()
            return True
        except Exception:
            return False

    return await asyncio.to_thread(_query)


async def refresh_proxy_alert_snapshots_best_effort() -> dict[str, Any]:
    proxy_efficiency_7d = _build_proxy_efficiency_metrics(await _fetch_proxy_efficiency_aggregate(7), window_days=7)
    proxy_efficiency_30d = _build_proxy_efficiency_metrics(await _fetch_proxy_efficiency_aggregate(30), window_days=30)
    trends = _build_proxy_efficiency_trends(proxy_efficiency_7d, proxy_efficiency_30d)
    payload = _build_proxy_alert_snapshot_rows(trends)
    persisted = await _persist_proxy_alert_snapshots(payload)
    PROXY_ALERT_SNAPSHOT_STATE.update(
        {
            "status": "ok" if persisted else "skipped",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_source_rows": len(trends.get("providers") or []),
            "last_rollup_rows": len(payload),
            "last_error": None if persisted else "proxy alert snapshot persistence skipped",
        }
    )
    return {
        "status": "ok" if persisted else "skipped",
        "source_rows": len(trends.get("providers") or []),
        "rollup_rows": len(payload),
        "persisted": persisted,
    }


def _build_audit_rollup_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str, str], dict[str, Any]] = {}
    now_iso = datetime.now(timezone.utc).isoformat()
    for row in rows:
        created_at = str(row.get("created_at") or "")
        day = created_at[:10] if created_at else datetime.now(timezone.utc).date().isoformat()
        action = str(row.get("action") or "unknown").lower()
        target_type = str(row.get("target_type") or "unknown").lower()
        key = (day, action, target_type)
        current = buckets.get(key)
        if current is None:
            current = {
                "day": day,
                "action": action,
                "target_type": target_type,
                "event_count": 0,
                "updated_at": now_iso,
            }
            buckets[key] = current
        current["event_count"] += 1
    return list(buckets.values())


def _build_audit_analytics_from_rollups(rows: list[dict[str, Any]]) -> dict[str, Any]:
    action_counts: dict[str, int] = {}
    target_counts: dict[str, int] = {}
    daily_counts: dict[str, int] = {}
    events_total = 0

    for row in rows:
        day = str(row.get("day") or "")
        action = str(row.get("action") or "unknown").lower()
        target_type = str(row.get("target_type") or "unknown").lower()
        event_count = int(row.get("event_count") or 0)
        if day:
            daily_counts[day] = daily_counts.get(day, 0) + event_count
        action_counts[action] = action_counts.get(action, 0) + event_count
        target_counts[target_type] = target_counts.get(target_type, 0) + event_count
        events_total += event_count

    return {
        "events_total": events_total,
        "action_counts": action_counts,
        "target_counts": target_counts,
        "daily_counts": daily_counts,
        "recent_events": [],
    }


def _build_retry_payload(job: dict[str, Any]) -> dict[str, Any]:
    url = job.get("normalized_url")
    format_id = job.get("requested_format_id")
    if not url or not format_id:
        raise HTTPException(status_code=400, detail="Job does not have enough data to retry.")

    return {
        "url": url,
        "format_id": format_id,
        "format_type": job.get("requested_media_type") or "video",
        "filename": job.get("result_asset_id"),
        "delivery_target": job.get("source_channel") or "web",
    }


async def _load_retry_user(job: dict[str, Any]) -> dict[str, Any]:
    user_id = job.get("user_id")
    if user_id:
        profile = await _fetch_profile(str(user_id))
        if profile:
            return {
                **profile,
                "id": profile.get("id"),
                "plan": profile.get("plan") or "free",
                "role": profile.get("role") or "user",
                "is_owner": str(profile.get("role") or "").lower() in {"owner", "admin"},
                "limit_bypass": str(profile.get("role") or "").lower() in {"owner", "admin"},
                "anonymous": False,
                "account_status": profile.get("account_status") or "active",
                "entitlement": build_effective_entitlement(profile),
            }

    guest = {
        "id": None,
        "email": "anonymous",
        "plan": "free",
        "role": "guest",
        "is_owner": False,
        "limit_bypass": False,
        "anonymous": True,
        "account_status": "active",
    }
    guest["entitlement"] = build_effective_entitlement(guest)
    return guest


@router.get("/summary")
async def owner_summary(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    profiles = await _fetch_profiles(limit=200)
    revenue_analytics = await _get_revenue_analytics_with_rollup_fallback(limit=200)
    history_analytics = await _get_history_analytics_with_rollup_fallback(limit=200)
    subscription_analytics = await _get_subscription_analytics_with_rollup_fallback(limit=500)
    audit_analytics = await _get_audit_analytics_with_rollup_fallback(limit=200)
    abuse_analytics = await _get_abuse_analytics_with_rollup_fallback(limit=200)
    proxy_history_analytics = _build_proxy_history_analytics(await _fetch_proxy_burn_events(limit=200))
    proxy_breaker_history_analytics = await _get_proxy_breaker_history_with_rollup_fallback(limit=200)
    proxy_rollup_analytics = _build_proxy_rollup_analytics(await _fetch_proxy_daily_rollups(limit=365))
    proxy_breaker_posture_history = await _get_proxy_breaker_posture_history(limit=365)
    proxy_efficiency_7d = _build_proxy_efficiency_metrics(await _fetch_proxy_efficiency_aggregate(7), window_days=7)
    proxy_efficiency_30d = _build_proxy_efficiency_metrics(await _fetch_proxy_efficiency_aggregate(30), window_days=30)
    proxy_efficiency_trends = _build_proxy_efficiency_trends(proxy_efficiency_7d, proxy_efficiency_30d)
    proxy_alert_snapshots = await _fetch_proxy_alert_snapshots(limit=30)
    system_health = await owner_system_health({"is_owner": True})
    proxy_breaker_posture = _build_proxy_breaker_posture(system_health.get("proxy_telemetry") or {}, proxy_breaker_history_analytics)
    proxy_cost_analytics = _build_proxy_cost_analytics(
        system_health.get("proxy_telemetry") or {},
        proxy_history_analytics,
        proxy_rollup_analytics,
    )
    abuse_posture = await _build_abuse_posture(limit=500)
    referral_analytics = await get_referral_analytics(limit=200)
    job_summary = await summarize_jobs()

    role_counts: dict[str, int] = {}
    plan_counts: dict[str, int] = {}
    active_subscribers = 0

    for profile in profiles:
        role = str(profile.get("role") or "user").lower()
        plan = str(profile.get("plan") or "free").lower()
        role_counts[role] = role_counts.get(role, 0) + 1
        plan_counts[plan] = plan_counts.get(plan, 0) + 1
        if plan in {"pro", "premium", "api", "api_growth", "enterprise"}:
            active_subscribers += 1

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "users_total": len(profiles),
        "active_subscribers": active_subscribers,
        "role_counts": role_counts,
        "plan_counts": plan_counts,
        "jobs": {
            "total": job_summary["total_jobs"],
            "active": job_summary["active_jobs"],
            "statuses": job_summary["statuses"],
            "stages": job_summary["stages"],
        },
        "revenue_signals": {
            "payment_events": revenue_analytics["events_total"],
        },
        "vault_history": {
            "entries_total": history_analytics["entries_total"],
            "fallback_entries": history_analytics["fallback_entries"],
        },
        "subscriptions": {
            "total": subscription_analytics["subscriptions_total"],
            "active": subscription_analytics["active_count"],
            "expiring_soon": subscription_analytics["expiring_soon"],
        },
        "audit": {
            "events_total": audit_analytics["events_total"],
        },
        "abuse": {
            "events_total": abuse_analytics["events_total"],
            "flagged_users_total": abuse_posture["flagged_users_total"],
            "flagged_keys_total": abuse_posture["flagged_keys_total"],
        },
        "referrals": {
            "accepted_claims": referral_analytics["accepted_claims"],
            "rewarded_download_credits": referral_analytics["rewarded_download_credits"],
            "rewarded_api_credits": referral_analytics["rewarded_api_credits"],
        },
        "proxy_history": {
            "events_total": proxy_history_analytics["events_total"],
            "burn_events": proxy_history_analytics["burn_events"],
        },
        "proxy_breaker_history": {
            "events_total": proxy_breaker_history_analytics["events_total"],
            "providers": len(proxy_breaker_history_analytics["provider_counts"]),
        },
        "proxy_breaker_posture": {
            "recurring_offenders": proxy_breaker_posture["total_recurring_offenders"],
            "quarantined": proxy_breaker_posture["total_quarantined"],
        },
        "proxy_breaker_posture_history": {
            "rows_total": proxy_breaker_posture_history["rows_total"],
            "source": proxy_breaker_posture_history["source"],
        },
        "proxy_rollups": {
            "rows_total": proxy_rollup_analytics["rows_total"],
            "total_probes": proxy_rollup_analytics["total_probes"],
        },
        "proxy_costs": {
            "estimated_total_cost": proxy_cost_analytics["estimated_total_cost"],
            "burn_rate_per_1000_probes": proxy_cost_analytics["burn_rate_per_1000_probes"],
        },
        "proxy_efficiency": {
            "last_7_days": proxy_efficiency_7d,
            "last_30_days": proxy_efficiency_30d,
            "trends": proxy_efficiency_trends,
            "alert_history": proxy_alert_snapshots,
        },
        "proxy_automation": {
            **PROXY_AUTOMATION_RUN_STATE,
        },
    }


@router.get("/users")
async def owner_users(user: dict = Depends(_require_owner)) -> list[dict[str, Any]]:
    rows = await _fetch_profiles(limit=100)
    return [
        {
            "id": row.get("id"),
            "email": row.get("email"),
            "plan": row.get("plan", "free"),
            "role": row.get("role", "user"),
            "account_status": row.get("account_status", "active"),
            "downloads_today": row.get("downloads_today", 0),
            "created_at": row.get("created_at"),
        }
        for row in rows
    ]


@router.get("/users/{target_user_id}/inspect")
async def owner_inspect_user(target_user_id: str, user: dict = Depends(_require_owner)) -> dict[str, Any]:
    profile = await _fetch_profile(target_user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found.")

    keys = await list_all_api_keys(limit=200)
    user_keys = [row for row in keys if str(row.get("user_id") or "") == target_user_id][:20]
    jobs = await _fetch_user_jobs(target_user_id, limit=20)
    history = [
        row
        for row in await _fetch_media_history(limit=500)
        if str(row.get("user_id") or "") == target_user_id
    ][:20]
    subscription_rows = [
        row for row in await _fetch_subscriptions(limit=500) if str(row.get("user_id") or "") == target_user_id
    ]
    subscription = subscription_rows[0] if subscription_rows else None
    credit_grants = load_credit_grants(target_user_id)
    job_status_counts: dict[str, int] = {}
    for row in jobs:
        status = str(row.get("status") or "unknown").lower()
        job_status_counts[status] = job_status_counts.get(status, 0) + 1

    history_platform_counts: dict[str, int] = {}
    for row in history:
        platform = str(row.get("platform") or "unknown").lower()
        history_platform_counts[platform] = history_platform_counts.get(platform, 0) + 1

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "profile": profile,
        "subscription": subscription,
        "credit_grants": credit_grants,
        "keys": user_keys,
        "jobs": jobs,
        "history": history,
        "summary": {
            "keys_total": len(user_keys),
            "jobs_total": len(jobs),
            "history_total": len(history),
            "active_keys": sum(1 for row in user_keys if str(row.get("status") or "").lower() == "active"),
            "active_subscription": bool(
                subscription and str(subscription.get("status") or "").lower() in {"active", "trialing"}
            ),
            "job_status_counts": job_status_counts,
            "history_platform_counts": history_platform_counts,
        },
    }


@router.post("/users/{target_user_id}/profile")
async def owner_update_user_profile(
    target_user_id: str,
    payload: UserMutationPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    current = await _fetch_profile(target_user_id)
    if not current:
        raise HTTPException(status_code=404, detail="User not found.")
    if target_user_id == user.get("id") and payload.role and payload.role != current.get("role"):
        raise HTTPException(status_code=400, detail="Owner cannot change the current session role here.")

    updates: dict[str, Any] = {}
    if payload.role is not None:
        normalized_role = str(payload.role).strip().lower()
        if normalized_role not in {"user", "admin", "owner"}:
            raise HTTPException(status_code=400, detail="Unsupported role.")
        updates["role"] = normalized_role
    if payload.plan is not None:
        normalized = normalize_plan(payload.plan)
        if normalized not in KNOWN_PLANS:
            raise HTTPException(status_code=400, detail="Unsupported plan.")
        updates["plan"] = normalized

    updated = await _write_profile_fields(target_user_id, updates)
    if payload.reset_usage:
        await _clear_user_usage_buffers(target_user_id)

    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="update_user_profile",
        target_type="user",
        target_id=target_user_id,
        detail=payload.reason,
        payload={
            "updates": updates,
            "reset_usage": payload.reset_usage,
        },
    )
    return {
        "user_id": target_user_id,
        "profile": updated or current,
        "usage_reset": payload.reset_usage,
    }


@router.post("/users/{target_user_id}/credits")
async def owner_grant_user_credits(
    target_user_id: str,
    payload: CreditGrantPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    current = await _fetch_profile(target_user_id)
    if not current:
        raise HTTPException(status_code=404, detail="User not found.")

    granted = grant_credit_grants(
        target_user_id,
        bonus_download_credits=payload.bonus_download_credits,
        bonus_api_credits=payload.bonus_api_credits,
        actor_user_id=str(user.get("id") or "") or None,
        notes=payload.reason,
    )
    merged_profile = dict(current)
    merged_profile["bonus_download_credits"] = int(granted.get("bonus_download_credits") or 0)
    merged_profile["bonus_api_credits"] = int(granted.get("bonus_api_credits") or 0)
    merged_profile["credit_grants"] = granted

    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="grant_user_credits",
        target_type="user",
        target_id=target_user_id,
        detail=payload.reason,
        payload={
            "bonus_download_credits": int(granted.get("bonus_download_credits") or 0),
            "bonus_api_credits": int(granted.get("bonus_api_credits") or 0),
        },
    )

    return {
        "user_id": target_user_id,
        "credit_grants": granted,
        "profile": merged_profile,
    }


@router.get("/keys")
async def owner_keys(user: dict = Depends(_require_owner)) -> list[dict[str, Any]]:
    rows = await list_all_api_keys(limit=100)
    serialized: list[dict[str, Any]] = []
    for row in rows:
        override = await get_api_key_override(str(row.get("id") or ""))
        serialized.append(
            {
                "id": row.get("id"),
                "user_id": row.get("user_id"),
                "name": row.get("name"),
                "key_prefix": row.get("key_prefix"),
                "status": row.get("status", "unknown"),
                "scopes": row.get("scopes") or [],
                "rate_limit": row.get("rate_limit"),
                "plan_tier": row.get("plan_tier"),
                "last_used_at": row.get("last_used_at"),
                "last_ip": row.get("last_ip"),
                "created_at": row.get("created_at"),
                "updated_at": row.get("updated_at"),
                "override": override or {},
            }
        )
    return serialized


@router.get("/keys/{key_id}/usage")
async def owner_key_usage(key_id: str, user: dict = Depends(_require_owner)) -> dict[str, Any]:
    key_row = await get_api_key_record_for_user(None, key_id)
    if not key_row:
        raise HTTPException(status_code=404, detail="API key not found.")
    usage = await summarize_api_key_usage(key_id)
    override = await get_api_key_override(key_id)
    return {"key": key_row, "override": override or {}, "usage": usage}


@router.get("/keys/failure-alerts")
async def owner_key_failure_alerts(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    keys = await owner_keys({"is_owner": True})
    return await _build_api_key_failure_alerts(keys)


@router.patch("/keys/{key_id}")
async def owner_update_key(
    key_id: str,
    payload: KeyMutationPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    updates: dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.scopes is not None:
        updates["scopes"] = payload.scopes
    if payload.rate_limit is not None:
        updates["rate_limit"] = payload.rate_limit
    if not updates:
        raise HTTPException(status_code=400, detail="No API key updates provided.")

    record = await update_api_key_record(None, key_id, updates)
    if not record:
        raise HTTPException(status_code=404, detail="API key not found.")

    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="update_key",
        target_type="api_key",
        target_id=key_id,
        payload={"updates": updates},
    )
    return {"status": "updated", "data": record}


@router.post("/keys/{key_id}/throttle")
async def owner_throttle_key(
    key_id: str,
    payload: KeyThrottlePayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    current = await get_api_key_record_for_user(None, key_id)
    if not current:
        raise HTTPException(status_code=404, detail="API key not found.")

    current_limit = int(current.get("rate_limit") or 120)
    next_limit = payload.rate_limit if payload.rate_limit is not None else max(5, current_limit // 2)
    next_limit = max(1, int(next_limit))
    record = await update_api_key_record(None, key_id, {"rate_limit": next_limit})
    if not record:
        raise HTTPException(status_code=404, detail="API key not found.")

    detail = payload.reason or f"Owner throttled key to {next_limit} RPM after elevated failure rate."
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="throttle_key",
        target_type="api_key",
        target_id=key_id,
        detail=detail,
        payload={
            "previous_rate_limit": current_limit,
            "new_rate_limit": next_limit,
            "reason": payload.reason,
        },
    )
    await _record_abuse_event(
        user_id=str(record.get("user_id") or ""),
        event_type="owner_key_throttled",
        detail=detail,
    )
    return {
        "status": "throttled",
        "data": record,
        "previous_rate_limit": current_limit,
        "new_rate_limit": next_limit,
    }


@router.post("/keys/{key_id}/rotate")
async def owner_rotate_key(key_id: str, user: dict = Depends(_require_owner)) -> dict[str, Any]:
    raw_key, record = await rotate_api_key_record(None, key_id)
    if not raw_key or not record:
        raise HTTPException(status_code=404, detail="API key not found.")

    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="rotate_key",
        target_type="api_key",
        target_id=key_id,
        payload={"status": "active"},
    )
    return {"status": "rotated", "key": raw_key, "data": record}


@router.get("/enterprise/accounts")
async def owner_enterprise_accounts(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    profiles = await _fetch_profiles(limit=250)
    subscriptions = await _fetch_subscriptions(limit=1000)
    keys = await list_all_api_keys(limit=500)
    subscription_by_user = {str(row.get("user_id") or ""): row for row in subscriptions}
    enterprise_profiles = [
        row
        for row in profiles
        if str(row.get("plan") or "").lower() in {"api", "api_growth", "enterprise"}
        or str((subscription_by_user.get(str(row.get("id") or "")) or {}).get("plan_code") or "").lower()
        in {"api", "api_growth", "enterprise"}
    ]
    accounts: list[dict[str, Any]] = []
    for profile in enterprise_profiles:
        user_id = str(profile.get("id") or "")
        account_keys = [row for row in keys if str(row.get("user_id") or "") == user_id]
        overrides = [await get_api_key_override(str(row.get("id") or "")) for row in account_keys]
        accounts.append(
            {
                "user_id": user_id,
                "email": profile.get("email"),
                "plan": profile.get("plan") or "free",
                "subscription_plan": (subscription_by_user.get(user_id) or {}).get("plan_code"),
                "subscription_status": (subscription_by_user.get(user_id) or {}).get("status"),
                "keys_total": len(account_keys),
                "active_keys": sum(1 for row in account_keys if str(row.get("status") or "").lower() == "active"),
                "customized_keys": sum(1 for item in overrides if item),
                "webhook_ready_keys": sum(1 for item in overrides if bool((item or {}).get("webhooks_enabled"))),
                "downloads_today": int(profile.get("downloads_today") or 0),
                "created_at": profile.get("created_at"),
            }
        )
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "accounts_total": len(accounts),
        "accounts": accounts,
    }


@router.get("/enterprise/accounts/{target_user_id}")
async def owner_enterprise_account_detail(target_user_id: str, user: dict = Depends(_require_owner)) -> dict[str, Any]:
    snapshot = await _build_enterprise_account_snapshot(target_user_id)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        **snapshot,
    }


@router.patch("/enterprise/accounts/{target_user_id}")
async def owner_enterprise_account_update(
    target_user_id: str,
    payload: EnterpriseAccountMutationPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    current = await _fetch_profile(target_user_id)
    if not current:
        raise HTTPException(status_code=404, detail="User not found.")

    updates: dict[str, Any] = {}
    if payload.plan is not None:
        normalized_plan = normalize_plan(payload.plan)
        if normalized_plan not in KNOWN_PLANS:
            raise HTTPException(status_code=400, detail="Unsupported plan.")
        updates["plan"] = normalized_plan

    if updates:
        await _write_profile_fields(target_user_id, updates)
        if updates.get("plan") in {"api", "api_growth", "enterprise"} and supabase:
            subscription_payload = {
                "user_id": target_user_id,
                "provider": "owner_manual",
                "provider_subscription_id": f"owner-manual:{target_user_id}",
                "status": "active",
                "plan_code": updates["plan"],
                "current_period_end": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
                "cancel_at_period_end": False,
            }

            def _upsert_subscription():
                try:
                    existing = supabase.table("subscriptions").select("id").eq("user_id", target_user_id).maybe_single().execute()
                    if existing.data:
                        supabase.table("subscriptions").update(subscription_payload).eq("user_id", target_user_id).execute()
                    else:
                        supabase.table("subscriptions").insert(subscription_payload).execute()
                except Exception:
                    return None

            await asyncio.to_thread(_upsert_subscription)

    key_rows = [row for row in await list_all_api_keys(limit=500) if str(row.get("user_id") or "") == target_user_id]
    override_payload = {
        "plan_tier_override": normalize_plan(payload.plan) if payload.plan else None,
        "custom_daily_quota": payload.custom_daily_quota,
        "custom_rate_limit": payload.custom_rate_limit,
        "custom_concurrency_limit": payload.custom_concurrency_limit,
        "webhooks_enabled": payload.webhooks_enabled,
        "priority_lane": payload.priority_lane,
        "retention_hours": payload.retention_hours,
        "notes": payload.notes or payload.reason,
    }
    if any(value is not None for value in override_payload.values()):
        for row in key_rows:
            await upsert_api_key_override(
                str(row.get("id") or ""),
                override_payload,
                fallback_user_id=target_user_id,
                actor_user_id=str(user.get("id") or "") or None,
            )

    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="update_enterprise_account",
        target_type="user",
        target_id=target_user_id,
        detail=payload.reason,
        payload={key: value for key, value in override_payload.items() if value is not None} | updates,
    )
    snapshot = await _build_enterprise_account_snapshot(target_user_id)
    return {"status": "updated", **snapshot}


@router.get("/enterprise/keys/{key_id}")
async def owner_enterprise_key_detail(key_id: str, user: dict = Depends(_require_owner)) -> dict[str, Any]:
    key_row = await get_api_key_record_for_user(None, key_id)
    if not key_row:
        raise HTTPException(status_code=404, detail="API key not found.")
    snapshot = await _build_enterprise_key_snapshot(key_row)
    return {"generated_at": datetime.now(timezone.utc).isoformat(), **snapshot}


@router.patch("/enterprise/keys/{key_id}")
async def owner_enterprise_key_update(
    key_id: str,
    payload: EnterpriseKeyOverridePayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    key_row = await get_api_key_record_for_user(None, key_id)
    if not key_row:
        raise HTTPException(status_code=404, detail="API key not found.")

    normalized_plan = normalize_plan(payload.plan_tier_override) if payload.plan_tier_override else None
    if normalized_plan and normalized_plan not in KNOWN_PLANS:
        raise HTTPException(status_code=400, detail="Unsupported Enterprise plan override.")

    override = await upsert_api_key_override(
        key_id,
        {
            "plan_tier_override": normalized_plan,
            "custom_daily_quota": payload.custom_daily_quota,
            "custom_rate_limit": payload.custom_rate_limit,
            "custom_concurrency_limit": payload.custom_concurrency_limit,
            "webhooks_enabled": payload.webhooks_enabled,
            "priority_lane": payload.priority_lane,
            "retention_hours": payload.retention_hours,
            "notes": payload.notes,
        },
        fallback_user_id=str(key_row.get("user_id") or ""),
        actor_user_id=str(user.get("id") or "") or None,
    )

    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="update_enterprise_key",
        target_type="api_key",
        target_id=key_id,
        payload=override,
    )
    snapshot = await _build_enterprise_key_snapshot(key_row)
    return {"status": "updated", **snapshot}


@router.get("/enterprise/analytics")
async def owner_enterprise_analytics(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    accounts = (await owner_enterprise_accounts({"is_owner": True})).get("accounts") or []
    plan_counts: dict[str, int] = {}
    subscription_status_counts: dict[str, int] = {}
    total_keys = 0
    total_customized_keys = 0
    total_webhook_ready_keys = 0
    for row in accounts:
        plan = str(row.get("subscription_plan") or row.get("plan") or "free").lower()
        status = str(row.get("subscription_status") or "none").lower()
        plan_counts[plan] = plan_counts.get(plan, 0) + 1
        subscription_status_counts[status] = subscription_status_counts.get(status, 0) + 1
        total_keys += int(row.get("keys_total") or 0)
        total_customized_keys += int(row.get("customized_keys") or 0)
        total_webhook_ready_keys += int(row.get("webhook_ready_keys") or 0)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "accounts_total": len(accounts),
        "plan_counts": plan_counts,
        "subscription_status_counts": subscription_status_counts,
        "keys_total": total_keys,
        "customized_keys_total": total_customized_keys,
        "webhook_ready_keys_total": total_webhook_ready_keys,
        "accounts": accounts[:20],
    }


@router.get("/jobs")
async def owner_jobs(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    summary = await summarize_jobs()
    return {
        "summary": {
            "total_jobs": summary["total_jobs"],
            "active_jobs": summary["active_jobs"],
            "statuses": summary["statuses"],
            "queues": summary["queues"],
            "stages": summary["stages"],
            "runners": summary["runners"],
            "avg_active_progress": summary["avg_active_progress"],
        },
        "recent_jobs": summary["recent_jobs"],
    }


@router.get("/revenue")
async def owner_revenue(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    zero_payload = {
        "revenue": 0,
        "mrr": 0,
        "events_total": 0,
        "captured_total": 0,
        "source": "fallback",
        "recent_events": [],
        "daily_counts": {},
        "plan_counts": {},
        "provider_counts": {},
        "vault_history": {
            "entries_total": 0,
            "fallback_entries": 0,
            "delivery_modes": {},
            "source": "fallback",
            "recent_entries": [],
        },
        "subscriptions": {
            "subscriptions_total": 0,
            "active_count": 0,
            "expiring_soon": 0,
            "canceling": 0,
            "status_counts": {},
            "plan_counts": {},
            "provider_counts": {},
            "daily_counts": {},
            "recent_subscriptions": [],
            "source": "fallback",
        },
        "audit": {
            "events_total": 0,
            "action_counts": {},
            "target_counts": {},
            "daily_counts": {},
            "recent_events": [],
            "source": "fallback",
        },
        "abuse": {
            "events_total": 0,
            "affected_users": 0,
            "event_counts": {},
            "daily_counts": {},
            "recent_events": [],
            "source": "fallback",
        },
        "billing_incidents": {
            "events_total": 0,
            "provider_counts": {},
            "incident_type_counts": {},
            "daily_counts": {},
            "recent_events": [],
        },
        "proxy_history": {"source": "fallback", "recent_events": [], "provider_counts": {}, "event_counts": {}},
        "proxy_breaker_history": {"source": "fallback", "recent_rows": [], "daily_quarantine_counts": {}, "provider_counts": {}},
        "proxy_breaker_posture": {"status": "idle", "quarantined_provider_count": 0, "auto_paused_provider_count": 0},
        "proxy_breaker_posture_history": {"recent_rows": [], "daily_quarantine_counts": {}},
        "proxy_rollups": {"source": "fallback", "daily_counts": {}, "provider_counts": {}},
        "proxy_costs": {"estimated_total_cost": 0, "burn_rate_per_1000_probes": 0, "success_rate": 0, "proxy_usage_rate": 0},
        "proxy_efficiency": {
            "last_7_days": {"window_days": 7, "success_rate": 0, "proxy_usage_rate": 0},
            "last_30_days": {"window_days": 30, "success_rate": 0, "proxy_usage_rate": 0},
            "trends": {},
            "alert_history": [],
        },
    }

    try:
        revenue_analytics = await _get_revenue_analytics_with_rollup_fallback(limit=200)
        history_analytics = await _get_history_analytics_with_rollup_fallback(limit=200)
        subscription_analytics = await _get_subscription_analytics_with_rollup_fallback(limit=500)
        audit_analytics = await _get_audit_analytics_with_rollup_fallback(limit=200)
        abuse_analytics = await _get_abuse_analytics_with_rollup_fallback(limit=200)
        billing_incident_analytics = _build_billing_incident_analytics(await _fetch_billing_incidents(limit=200))
        proxy_history_analytics = _build_proxy_history_analytics(await _fetch_proxy_burn_events(limit=200))
        proxy_breaker_history_analytics = await _get_proxy_breaker_history_with_rollup_fallback(limit=200)
        proxy_rollup_analytics = _build_proxy_rollup_analytics(await _fetch_proxy_daily_rollups(limit=365))
        proxy_breaker_posture_history = await _get_proxy_breaker_posture_history(limit=365)
        proxy_efficiency_7d = _build_proxy_efficiency_metrics(await _fetch_proxy_efficiency_aggregate(7), window_days=7)
        proxy_efficiency_30d = _build_proxy_efficiency_metrics(await _fetch_proxy_efficiency_aggregate(30), window_days=30)
        proxy_efficiency_trends = _build_proxy_efficiency_trends(proxy_efficiency_7d, proxy_efficiency_30d)
        proxy_alert_snapshots = await _fetch_proxy_alert_snapshots(limit=30)
        system_health = await owner_system_health({"is_owner": True})
        proxy_breaker_posture = _build_proxy_breaker_posture(system_health.get("proxy_telemetry") or {}, proxy_breaker_history_analytics)
        proxy_cost_analytics = _build_proxy_cost_analytics(
            system_health.get("proxy_telemetry") or {},
            proxy_history_analytics,
            proxy_rollup_analytics,
        )
        return {
            **zero_payload,
            **revenue_analytics,
            "vault_history": history_analytics,
            "subscriptions": subscription_analytics,
            "audit": audit_analytics,
            "abuse": abuse_analytics,
            "billing_incidents": billing_incident_analytics,
            "proxy_history": proxy_history_analytics,
            "proxy_breaker_history": proxy_breaker_history_analytics,
            "proxy_breaker_posture": proxy_breaker_posture,
            "proxy_breaker_posture_history": proxy_breaker_posture_history,
            "proxy_rollups": proxy_rollup_analytics,
            "proxy_costs": proxy_cost_analytics,
            "proxy_efficiency": {
                "last_7_days": proxy_efficiency_7d,
                "last_30_days": proxy_efficiency_30d,
                "trends": proxy_efficiency_trends,
                "alert_history": proxy_alert_snapshots,
            },
        }
    except Exception:
        return zero_payload


@router.get("/subscription-analytics")
async def owner_subscription_analytics(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await _get_subscription_analytics_with_rollup_fallback(limit=500)


@router.get("/audit-analytics")
async def owner_audit_analytics(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await _get_audit_analytics_with_rollup_fallback(limit=500)


@router.get("/billing-incidents")
async def owner_billing_incidents(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return _build_billing_incident_analytics(await _fetch_billing_incidents(limit=200))


@router.get("/delivery-incidents")
async def owner_delivery_incidents(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return _build_delivery_incident_analytics(await _fetch_delivery_incidents(limit=200))


@router.get("/queue-incidents")
async def owner_queue_incidents(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return _build_queue_incident_analytics(await _fetch_queue_incidents(limit=200))


@router.get("/billing-incidents-export")
async def owner_billing_incidents_export(user: dict = Depends(_require_owner)) -> Response:
    rows = await _fetch_billing_incidents(limit=1000)
    csv_body = _rows_to_csv(
        rows,
        [
            "provider",
            "incident_type",
            "event_type",
            "provider_reference",
            "detail",
            "status_code",
            "created_at",
        ],
    )
    filename = f"nexus_billing_incidents_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/delivery-incidents-export")
async def owner_delivery_incidents_export(user: dict = Depends(_require_owner)) -> Response:
    rows = await _fetch_delivery_incidents(limit=1000)
    csv_body = _rows_to_csv(
        rows,
        [
            "provider",
            "incident_type",
            "artifact_mode",
            "job_id",
            "filename",
            "detail",
            "created_at",
        ],
    )
    filename = f"nexus_delivery_incidents_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/queue-incidents-export")
async def owner_queue_incidents_export(user: dict = Depends(_require_owner)) -> Response:
    rows = await _fetch_queue_incidents(limit=1000)
    csv_body = _rows_to_csv(
        rows,
        [
            "provider",
            "incident_type",
            "queue_name",
            "job_id",
            "runner",
            "detail",
            "created_at",
        ],
    )
    filename = f"nexus_queue_incidents_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/proxy-history")
async def owner_proxy_history(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    rows = await _fetch_proxy_burn_events(limit=500)
    return _build_proxy_history_analytics(rows)


@router.get("/proxy-rollups")
async def owner_proxy_rollups(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    rows = await _fetch_proxy_daily_rollups(limit=365)
    analytics = _build_proxy_rollup_analytics(rows)
    analytics["source"] = "daily_rollups" if analytics.get("rows_total") else "live_unavailable"
    return analytics


@router.get("/proxy-breaker-history")
async def owner_proxy_breaker_history(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await _get_proxy_breaker_history_with_rollup_fallback(limit=200)


@router.get("/proxy-breaker-posture-history")
async def owner_proxy_breaker_posture_history(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await _get_proxy_breaker_posture_history(limit=365)


@router.get("/paddle-requests")
@router.get("/stripe-requests")  # kept for backwards compat with existing dashboard fetches
async def owner_paddle_requests(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    rows = await _fetch_paddle_waitlist_requests(limit=100)
    requested_plan_counts: dict[str, int] = {}
    for row in rows:
        requested_plan = str(row.get("requested_plan") or "unknown").lower()
        requested_plan_counts[requested_plan] = requested_plan_counts.get(requested_plan, 0) + 1

    return {
        "requests_total": len(rows),
        "requested_plan_counts": requested_plan_counts,
        "recent_requests": rows,
    }


@router.get("/referrals")
async def owner_referrals(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await get_referral_analytics(limit=300)


@router.get("/history-analytics")
async def owner_history_analytics(
    delivery_mode: str | None = Query(default=None),
    platform: str | None = Query(default=None),
    format_type: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    rows = await _fetch_media_history_filtered(
        limit=limit,
        delivery_mode=delivery_mode,
        platform=platform,
        format_type=format_type,
    )
    analytics = _build_history_analytics(rows)
    return {
        "filters": {
            "delivery_mode": delivery_mode,
            "platform": platform,
            "format_type": format_type,
            "limit": limit,
        },
        "source": "filtered_live",
        **analytics,
    }


@router.post("/rollups/rebuild-history")
async def owner_rebuild_history_rollups(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await refresh_history_rollups_best_effort()


@router.get("/history-export")
async def owner_history_export(
    delivery_mode: str | None = Query(default=None),
    platform: str | None = Query(default=None),
    format_type: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    user: dict = Depends(_require_owner),
) -> Response:
    rows = await _fetch_media_history_filtered(
        limit=limit,
        delivery_mode=delivery_mode,
        platform=platform,
        format_type=format_type,
    )
    csv_body = _rows_to_csv(
        rows,
        [
            "id",
            "user_id",
            "title",
            "url",
            "platform",
            "format",
            "format_type",
            "filesize",
            "duration",
            "job_id",
            "filename",
            "direct_url",
            "fallback_url",
            "delivery_mode",
            "expires_at",
            "created_at",
        ],
    )
    filename = f"nexus_history_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/revenue-export")
async def owner_revenue_export(user: dict = Depends(_require_owner)) -> Response:
    rows = await _fetch_revenue_events(limit=1000)
    csv_body = _rows_to_csv(
        rows,
        [
            "id",
            "user_id",
            "event_type",
            "plan",
            "razorpay_order_id",
            "razorpay_payment_id",
            "created_at",
        ],
    )
    filename = f"nexus_revenue_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/audit-export")
async def owner_audit_export(user: dict = Depends(_require_owner)) -> Response:
    rows = await _fetch_owner_audit_events(limit=1000)
    csv_body = _rows_to_csv(
        rows,
        [
            "id",
            "actor_user_id",
            "action",
            "target_type",
            "target_id",
            "detail",
            "created_at",
        ],
    )
    filename = f"nexus_audit_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/proxy-alert-export")
async def owner_proxy_alert_export(user: dict = Depends(_require_owner)) -> Response:
    rows = await _fetch_proxy_alert_snapshots(limit=1000)
    csv_body = _rows_to_csv(
        rows,
        [
            "snapshot_date",
            "provider_name",
            "total_probes_7d",
            "success_rate_pct_7d",
            "burn_rate_per_1k_7d",
            "cost_per_success_usd_7d",
            "success_rate_pct_30d",
            "burn_rate_per_1k_30d",
            "cost_per_success_usd_30d",
            "alert_count",
            "low_success_rate",
            "high_burn_rate",
            "high_cost_per_success",
            "success_rate_drop",
            "burn_rate_increase",
            "cost_increase",
            "updated_at",
        ],
    )
    filename = f"nexus_proxy_alert_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/proxy-quarantine-export")
async def owner_proxy_quarantine_export(user: dict = Depends(_require_owner)) -> Response:
    system_health = await owner_system_health({"is_owner": True})
    proxy_breaker_history = await _get_proxy_breaker_history_with_rollup_fallback(limit=200)
    proxy_breaker_posture = _build_proxy_breaker_posture(
        system_health.get("proxy_telemetry") or {},
        proxy_breaker_history,
    )
    rows = _build_proxy_quarantine_export_rows(proxy_breaker_posture, proxy_breaker_history)
    csv_body = _rows_to_csv(
        rows,
        [
            "generated_at",
            "provider_name",
            "is_recurring_offender",
            "is_quarantined",
            "escalation_level",
            "recovery_status",
            "trip_count_with_current",
            "recent_breaker_trips_in_window",
            "trip_window_hours",
            "quarantine_until",
            "next_health_check_at",
            "last_reason",
            "history_events_total_for_provider",
            "history_events_total_global",
            "recurring_offenders_total",
            "quarantined_total",
            "escalation_counts",
        ],
    )
    filename = f"nexus_proxy_quarantine_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/rollups/rebuild-revenue")
async def owner_rebuild_revenue_rollups(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await refresh_revenue_rollups_best_effort()


@router.post("/rollups/rebuild-audit")
async def owner_rebuild_audit_rollups(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await refresh_audit_rollups_best_effort()


@router.post("/rollups/rebuild-subscriptions")
async def owner_rebuild_subscription_rollups(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await refresh_subscription_rollups_best_effort()


@router.post("/billing/reconcile-subscriptions")
async def owner_reconcile_subscriptions(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await refresh_billing_reconciliation_best_effort()


@router.post("/rollups/rebuild-abuse")
async def owner_rebuild_abuse_rollups(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await refresh_abuse_rollups_best_effort()


@router.post("/rollups/rebuild-proxy")
async def owner_rebuild_proxy_rollups(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await refresh_proxy_rollups_best_effort()


@router.post("/rollups/rebuild-proxy-alerts")
async def owner_rebuild_proxy_alert_snapshots(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await refresh_proxy_alert_snapshots_best_effort()


@router.post("/rollups/rebuild-proxy-breaker-history")
async def owner_rebuild_proxy_breaker_rollups(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await refresh_proxy_alert_rollups_best_effort()


@router.post("/rollups/rebuild-proxy-breaker-posture")
async def owner_rebuild_proxy_breaker_posture_rollups(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await refresh_proxy_breaker_posture_rollups_best_effort()


@router.get("/abuse")
async def owner_abuse(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await _get_abuse_analytics_with_rollup_fallback(limit=200)


@router.get("/abuse-posture")
async def owner_abuse_posture(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await _build_abuse_posture(limit=500)


@router.get("/system-health")
async def owner_system_health(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    temp_dir = os.path.join(os.path.dirname(__file__), ".runtime")
    disk = shutil.disk_usage(os.path.dirname(__file__))
    workers = await _get_worker_snapshot()
    fallback_delivery = {
        **get_local_artifact_stats(),
        "cleanup_interval_seconds": max(60, int(os.environ.get("FALLBACK_CLEANUP_INTERVAL_SECONDS", "900"))),
    }
    proxy_telemetry = get_proxy_telemetry()
    redis_runtime = await get_redis_runtime_status()
    runtime_controls = await get_runtime_ops_state()
    return {
        "redis": redis_runtime,
        "redis_configured": bool(redis_runtime.get("configured")),
        "celery_enabled": os.environ.get("NEXUS_USE_CELERY", "0") == "1",
        "temp_dir_exists": os.path.exists(temp_dir),
        "disk_total_gb": round(disk.total / (1024**3), 2),
        "disk_free_gb": round(disk.free / (1024**3), 2),
        "disk_used_gb": round(disk.used / (1024**3), 2),
        "r2_configured": bool(os.environ.get("R2_BUCKET") and os.environ.get("R2_ACCESS_KEY_ID")),
        "proxy_configured": bool(os.environ.get("PROXY_URL") or os.environ.get("RESIDENTIAL_PROXY_URL") or os.environ.get("YOUTUBE_PROXY_POOL")),
        "billing": {
            "razorpay_configured": bool(os.environ.get("RAZORPAY_KEY_ID") and os.environ.get("RAZORPAY_KEY_SECRET")),
            "paddle_enabled": is_paddle_enabled(),
            "paddle_configured": is_paddle_configured(),
            "paddle_waitlist_mode": not is_paddle_enabled(),
        },
        "proxy_telemetry": proxy_telemetry,
        "runtime_controls": runtime_controls,
        "workers": workers,
        "fallback_delivery": fallback_delivery,
        "rollup_refresh": {
            **ROLLUP_REFRESH_STATE,
            "interval_seconds": max(300, int(os.environ.get("VAULT_HISTORY_ROLLUP_INTERVAL_SECONDS", "1800"))),
        },
        "revenue_rollup_refresh": {
            **REVENUE_ROLLUP_REFRESH_STATE,
            "interval_seconds": max(300, int(os.environ.get("REVENUE_ROLLUP_INTERVAL_SECONDS", "1800"))),
        },
        "audit_rollup_refresh": {
            **AUDIT_ROLLUP_REFRESH_STATE,
            "interval_seconds": max(300, int(os.environ.get("AUDIT_ROLLUP_INTERVAL_SECONDS", "1800"))),
        },
        "subscription_rollup_refresh": {
            **SUBSCRIPTION_ROLLUP_REFRESH_STATE,
            "interval_seconds": max(300, int(os.environ.get("SUBSCRIPTION_ROLLUP_INTERVAL_SECONDS", "1800"))),
        },
        "billing_reconciliation": {
            **BILLING_RECONCILIATION_STATE,
            "interval_seconds": max(900, int(os.environ.get("BILLING_RECONCILIATION_INTERVAL_SECONDS", "3600"))),
        },
        "abuse_rollup_refresh": {
            **ABUSE_ROLLUP_REFRESH_STATE,
            "interval_seconds": max(300, int(os.environ.get("ABUSE_ROLLUP_INTERVAL_SECONDS", "1800"))),
        },
        "proxy_rollup_refresh": {
            **PROXY_ROLLUP_REFRESH_STATE,
            "interval_seconds": max(60, int(os.environ.get("PROXY_ROLLUP_FLUSH_INTERVAL_SECONDS", "300"))),
        },
        "proxy_alert_snapshot_refresh": {
            **PROXY_ALERT_SNAPSHOT_STATE,
            "interval_seconds": max(300, int(os.environ.get("PROXY_ALERT_SNAPSHOT_INTERVAL_SECONDS", "3600"))),
        },
        "proxy_breaker_rollup_refresh": {
            **PROXY_ALERT_ROLLUP_REFRESH_STATE,
            "interval_seconds": max(300, int(os.environ.get("PROXY_ALERT_ROLLUP_INTERVAL_SECONDS", "1800"))),
        },
        "proxy_breaker_posture_rollup_refresh": {
            **PROXY_BREAKER_POSTURE_ROLLUP_REFRESH_STATE,
            "interval_seconds": max(300, int(os.environ.get("PROXY_BREAKER_POSTURE_ROLLUP_INTERVAL_SECONDS", "1800"))),
        },
        "proxy_auto_recovery": {
            "poll_interval_seconds": max(300, int(os.environ.get("PROXY_AUTO_RECOVERY_POLL_INTERVAL_SECONDS", "600"))),
            "cooldown_seconds": max(3600, int(os.environ.get("PROXY_AUTO_RECOVERY_INTERVAL_SECONDS", "7200"))),
        },
        "proxy_circuit_breaker": {
            "watchdog_interval_seconds": 60,
        },
        "proxy_automation": {
            **PROXY_AUTOMATION_RUN_STATE,
            "escalation_window_hours": max(1, int(os.environ.get("PROXY_BREAKER_ESCALATION_WINDOW_HOURS", "24"))),
        },
    }


@router.get("/stream")
async def owner_stream(request: Request, user: dict = Depends(_require_owner)) -> StreamingResponse:
    async def event_generator():
        while True:
            if await request.is_disconnected():
                break
            snapshot = await _build_owner_snapshot()
            yield f"event: owner_snapshot\ndata: {json.dumps(snapshot)}\n\n"
            await asyncio.sleep(5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/proxy/clear-burn")
async def owner_clear_proxy_burn(
    payload: ProxyActionPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    telemetry = clear_proxy_burn()
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="clear_proxy_burn",
        target_type="proxy",
        target_id="metadata_proxy",
        detail=payload.reason,
        payload={"burn_active": telemetry.get("burn_active")},
    )
    return {"status": "ok", "proxy_telemetry": telemetry}


@router.post("/proxy/pause")
async def owner_pause_proxy(
    payload: ProxyActionPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    telemetry = set_proxy_paused(True)
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="pause_proxy",
        target_type="proxy",
        target_id="metadata_proxy",
        detail=payload.reason,
        payload={"manually_paused": telemetry.get("manually_paused")},
    )
    return {"status": "ok", "proxy_telemetry": telemetry}


@router.post("/proxy/resume")
async def owner_resume_proxy(
    payload: ProxyActionPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    telemetry = set_proxy_paused(False)
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="resume_proxy",
        target_type="proxy",
        target_id="metadata_proxy",
        detail=payload.reason,
        payload={"manually_paused": telemetry.get("manually_paused")},
    )
    return {"status": "ok", "proxy_telemetry": telemetry}


@router.post("/proxy/provider/pause")
async def owner_pause_provider_proxy(
    payload: ProxyProviderActionPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    telemetry = set_provider_proxy_paused(payload.provider, True)
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="pause_provider_proxy",
        target_type="proxy_provider",
        target_id=payload.provider.lower(),
        detail=payload.reason,
        payload={"paused_providers": telemetry.get("paused_providers")},
    )
    return {"status": "ok", "proxy_telemetry": telemetry}


@router.post("/proxy/provider/resume")
async def owner_resume_provider_proxy(
    payload: ProxyProviderActionPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    telemetry = set_provider_proxy_paused(payload.provider, False)
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="resume_provider_proxy",
        target_type="proxy_provider",
        target_id=payload.provider.lower(),
        detail=payload.reason,
        payload={"paused_providers": telemetry.get("paused_providers")},
    )
    return {"status": "ok", "proxy_telemetry": telemetry}


@router.post("/proxy/provider/quarantine")
async def owner_force_quarantine_provider_proxy(
    payload: ProxyProviderActionPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    telemetry = set_provider_proxy_quarantined(payload.provider, True, reason=payload.reason)
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="force_quarantine_provider_proxy",
        target_type="proxy_provider",
        target_id=payload.provider.lower(),
        detail=payload.reason,
        payload={"auto_paused_providers": telemetry.get("auto_paused_providers")},
    )
    return {"status": "ok", "proxy_telemetry": telemetry}


@router.post("/proxy/provider/release-quarantine")
async def owner_release_quarantine_provider_proxy(
    payload: ProxyProviderActionPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    telemetry = set_provider_proxy_quarantined(payload.provider, False, reason=payload.reason)
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="release_quarantine_provider_proxy",
        target_type="proxy_provider",
        target_id=payload.provider.lower(),
        detail=payload.reason,
        payload={"auto_paused_providers": telemetry.get("auto_paused_providers")},
    )
    return {"status": "ok", "proxy_telemetry": telemetry}


@router.get("/proxy/stats")
async def owner_proxy_stats(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return {
        "status": "ok",
        "youtube_proxy_pool": get_youtube_proxy_pool_stats(),
        "proxy_telemetry": get_proxy_telemetry(),
    }


@router.post("/proxy/automation/run")
async def owner_run_proxy_automation(
    payload: ProxyAutomationPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    if payload.action:
        action_result = await asyncio.to_thread(
            run_youtube_proxy_pool_action,
            payload.action,
            reason=payload.reason,
        )
        await _record_owner_audit_event(
            actor_user_id=str(user.get("id") or ""),
            action=f"run_youtube_proxy_pool_action:{payload.action}",
            target_type="proxy_pool",
            target_id="youtube",
            detail=payload.reason,
            payload={
                "action": payload.action,
                "status": action_result.get("status"),
                "pool": action_result.get("pool"),
            },
        )
        return {
            "status": action_result.get("status", "ok"),
            "action": payload.action,
            "reason": action_result.get("reason"),
            "youtube_proxy_pool": action_result.get("pool") or get_youtube_proxy_pool_stats(),
            "proxy_telemetry": get_proxy_telemetry(),
            "selected_proxy": action_result.get("selected_proxy"),
        }

    breaker_result = await asyncio.to_thread(enforce_circuit_breakers)
    probe_result = await asyncio.to_thread(probe_paused_providers)
    proxy_telemetry = get_proxy_telemetry()
    proxy_breaker_history = await _get_proxy_breaker_history_with_rollup_fallback(limit=200)
    proxy_breaker_posture = _build_proxy_breaker_posture(proxy_telemetry, proxy_breaker_history)

    quarantined_providers: list[str] = []
    already_quarantined = {
        str(item.get("provider_name") or "").lower()
        for item in (proxy_breaker_posture.get("quarantined_providers") or [])
    }
    for offender in proxy_breaker_posture.get("recurring_offenders") or []:
        provider_name = str(offender.get("provider_name") or "").strip().lower()
        if not provider_name or provider_name in already_quarantined:
            continue
        if int(offender.get("recent_breaker_trips_in_window") or 0) < 3:
            continue
        set_provider_proxy_quarantined(
            provider_name,
            True,
            reason=payload.reason or "Owner-triggered proxy automation escalation after repeated breaker trips.",
        )
        quarantined_providers.append(provider_name)

    if quarantined_providers:
        proxy_telemetry = get_proxy_telemetry()
        proxy_breaker_posture = _build_proxy_breaker_posture(proxy_telemetry, proxy_breaker_history)

    PROXY_AUTOMATION_RUN_STATE.update(
        {
            "status": "ok",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_error": None,
            "breaker_result": breaker_result,
            "probe_result": probe_result,
            "quarantined_providers": quarantined_providers,
        }
    )
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="run_proxy_automation",
        target_type="proxy",
        target_id=None,
        detail=payload.reason,
        payload={
            "breaker_result": breaker_result,
            "probe_result": probe_result,
            "quarantined_providers": quarantined_providers,
        },
    )
    return {
        "status": "ok",
        "breaker_result": breaker_result,
        "probe_result": probe_result,
        "quarantined_providers": quarantined_providers,
        "proxy_breaker_posture": proxy_breaker_posture,
        "proxy_telemetry": proxy_telemetry,
    }


@router.get("/system/runtime-controls")
async def owner_runtime_controls(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    return await get_runtime_ops_state()


@router.post("/system/maintenance/enable")
async def owner_enable_maintenance_mode(
    payload: RuntimeControlPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    controls = await set_runtime_ops_state(
        maintenance_mode=True,
        actor_user_id=str(user.get("id") or ""),
        reason=payload.reason or "Owner enabled maintenance mode",
    )
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="enable_maintenance_mode",
        target_type="system",
        target_id="maintenance_mode",
        detail=payload.reason,
        payload=controls,
    )
    return {"status": "ok", "runtime_controls": controls}


@router.post("/system/maintenance/disable")
async def owner_disable_maintenance_mode(
    payload: RuntimeControlPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    controls = await set_runtime_ops_state(
        maintenance_mode=False,
        actor_user_id=str(user.get("id") or ""),
        reason=payload.reason or "Owner disabled maintenance mode",
    )
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="disable_maintenance_mode",
        target_type="system",
        target_id="maintenance_mode",
        detail=payload.reason,
        payload=controls,
    )
    return {"status": "ok", "runtime_controls": controls}


@router.post("/system/queue-drain/enable")
async def owner_enable_queue_drain_mode(
    payload: RuntimeControlPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    controls = await set_runtime_ops_state(
        queue_drain_mode=True,
        actor_user_id=str(user.get("id") or ""),
        reason=payload.reason or "Owner enabled queue drain mode",
    )
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="enable_queue_drain_mode",
        target_type="system",
        target_id="queue_drain_mode",
        detail=payload.reason,
        payload=controls,
    )
    return {"status": "ok", "runtime_controls": controls}


@router.post("/system/queue-drain/disable")
async def owner_disable_queue_drain_mode(
    payload: RuntimeControlPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    controls = await set_runtime_ops_state(
        queue_drain_mode=False,
        actor_user_id=str(user.get("id") or ""),
        reason=payload.reason or "Owner disabled queue drain mode",
    )
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="disable_queue_drain_mode",
        target_type="system",
        target_id="queue_drain_mode",
        detail=payload.reason,
        payload=controls,
    )
    return {"status": "ok", "runtime_controls": controls}


@router.post("/users/{target_user_id}/suspend")
async def owner_suspend_user(
    target_user_id: str,
    payload: UserStatusPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    if target_user_id == user.get("id"):
        raise HTTPException(status_code=400, detail="Owner cannot suspend the current session user.")

    redis_client = await ensure_redis_or_fail()
    await _write_profile_status(target_user_id, "suspended")
    await redis_client.set(f"blacklist:{target_user_id}", "1")
    await _record_abuse_event(target_user_id, "owner_suspend", payload.reason)
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="suspend_user",
        target_type="user",
        target_id=target_user_id,
        detail=payload.reason,
        payload={"account_status": "suspended"},
    )
    return {"user_id": target_user_id, "status": "suspended", "reason": payload.reason}


@router.post("/users/{target_user_id}/reactivate")
async def owner_reactivate_user(
    target_user_id: str,
    payload: UserStatusPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    redis_client = await ensure_redis_or_fail()
    await _write_profile_status(target_user_id, "active")
    await redis_client.delete(f"blacklist:{target_user_id}")
    await _record_abuse_event(target_user_id, "owner_reactivate", payload.reason)
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="reactivate_user",
        target_type="user",
        target_id=target_user_id,
        detail=payload.reason,
        payload={"account_status": "active"},
    )
    return {"user_id": target_user_id, "status": "active", "reason": payload.reason}


@router.post("/keys/{key_id}/revoke")
async def owner_revoke_key(key_id: str, user: dict = Depends(_require_owner)) -> dict[str, Any]:
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase is not configured.")

    key_row = await revoke_api_key_for_user(None, key_id)
    if not key_row:
        raise HTTPException(status_code=404, detail="API key not found.")

    key_hash = key_row.get("key_hash")
    if key_hash:
        redis_client = await ensure_redis_or_fail()
        await redis_client.delete(f"key_meta:{key_hash}")

    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="revoke_key",
        target_type="api_key",
        target_id=key_id,
        payload={"status": "revoked"},
    )
    return {"key_id": key_id, "status": "revoked"}


@router.post("/jobs/{job_id}/cancel", response_model=JobActionResponse)
async def owner_cancel_job(job_id: str, user: dict = Depends(_require_owner)) -> JobActionResponse:
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    status = str(job.get("status") or "unknown").lower()
    if status in {"completed", "failed", "cancelled"}:
        return JobActionResponse(job_id=job_id, status=status, message=f"Job already {status}.")

    celery_task_id = job.get("celery_task_id")
    if celery_task_id and celery_available and celery_app is not None:
        try:
            celery_app.control.revoke(celery_task_id)
        except Exception:
            pass

    next_status = "cancelled" if status == "queued" else "cancelling"
    await update_job(job_id, status=next_status, cancel_requested=True, error="Cancelled by owner", code="cancelled")
    await add_job_event(job_id, "cancel_requested", {"requested_by": user.get("id")})
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="cancel_job",
        target_type="job",
        target_id=job_id,
        payload={"status": status, "runner": job.get("runner")},
    )
    return JobActionResponse(job_id=job_id, status=next_status, message="Job cancellation requested.")


@router.post("/jobs/{job_id}/retry", response_model=JobActionResponse)
async def owner_retry_job(job_id: str, user: dict = Depends(_require_owner)) -> JobActionResponse:
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    payload = _build_retry_payload(job)
    retry_user = await _load_retry_user(job)
    entitlement = retry_user.get("entitlement") or build_effective_entitlement(retry_user)
    queue_name = str(entitlement.get("queue_priority") or "free_consumer")
    new_job_id = secrets.token_urlsafe(16)

    await register_job(
        new_job_id,
        {
            "user_id": retry_user.get("id"),
            "source_channel": payload["delivery_target"],
            "provider": job.get("provider"),
            "normalized_url": payload["url"],
            "requested_format_id": payload["format_id"],
            "requested_media_type": payload["format_type"],
            "queue_name": queue_name,
            "priority": queue_name,
            "status": "queued",
            "progress": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    await add_job_event(new_job_id, "retry_requested", {"source_job_id": job_id, "requested_by": user.get("id")})

    use_celery = os.environ.get("NEXUS_USE_CELERY", "0") == "1" and celery_available and celery_app is not None
    if use_celery:
        result = download_delivery_task.delay(new_job_id, payload, retry_user)
        await update_job(new_job_id, celery_task_id=result.id)
        await _record_owner_audit_event(
            actor_user_id=str(user.get("id") or ""),
            action="retry_job",
            target_type="job",
            target_id=job_id,
            payload={"new_job_id": new_job_id, "runner": "celery"},
        )
        return JobActionResponse(
            job_id=job_id,
            status="queued",
            message="Retry queued through Celery.",
            new_job_id=new_job_id,
        )

    asyncio.create_task(run_download_job_async(new_job_id, payload, retry_user))
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="retry_job",
        target_type="job",
        target_id=job_id,
        payload={"new_job_id": new_job_id, "runner": "local_async"},
    )
    return JobActionResponse(
        job_id=job_id,
        status="queued",
        message="Retry started through local async runner.",
        new_job_id=new_job_id,
    )


@router.post("/jobs/{job_id}/bump-priority")
async def owner_bump_job_priority(
    job_id: str,
    payload: JobPriorityPayload,
    user: dict = Depends(_require_owner),
) -> dict[str, Any]:
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    requested_priority = str(payload.priority or "owner_priority").strip().lower()
    if requested_priority not in {"owner_priority", "admin_priority", "premium_consumer", "pro_consumer", "api_bulk", "free_consumer"}:
        raise HTTPException(status_code=400, detail="Unsupported priority.")

    await update_job(job_id, priority=requested_priority, queue_name=requested_priority)
    await add_job_event(job_id, "priority_bumped", {"requested_by": user.get("id"), "priority": requested_priority})
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="bump_job_priority",
        target_type="job",
        target_id=job_id,
        detail=payload.reason,
        payload={"priority": requested_priority},
    )
    return {"job_id": job_id, "priority": requested_priority, "status": "updated"}


@router.post("/system/cleanup-fallbacks")
async def owner_cleanup_fallbacks(user: dict = Depends(_require_owner)) -> dict[str, Any]:
    removed = await asyncio.to_thread(cleanup_expired_local_artifacts)
    await _record_owner_audit_event(
        actor_user_id=str(user.get("id") or ""),
        action="cleanup_fallbacks",
        target_type="system",
        target_id="fallback_artifacts",
        payload={"removed": removed},
    )
    return {"status": "ok", "removed": removed}
