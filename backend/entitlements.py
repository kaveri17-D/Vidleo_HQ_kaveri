from __future__ import annotations

from copy import deepcopy
from typing import Any

OWNER_ROLES = {"owner", "admin"}
KNOWN_PLANS = {"free", "pro", "premium", "api", "api_growth", "enterprise"}

PLAN_DEFAULTS: dict[str, dict[str, Any]] = {
    "guest": {
        "plan": "free",
        "download_limit_daily": 3,
        "api_request_limit_daily": 0,
        "max_quality": 720,
        "audio_limit": 192,
        "queue_priority": "free_consumer",
        "max_concurrent_jobs": 1,
        "retention_hours": 0,
        "rate_limit_bypass": False,
        "4k_allowed": False,
        "api_enabled": False,
        "bot_priority": "free",
        "history_enabled": False,
        "direct_delivery_allowed": True,
        "cost_tolerance_level": "low",
    },
    "extension_guest": {
        "plan": "free",
        "download_limit_daily": 5,
        "api_request_limit_daily": 0,
        "max_quality": 720,
        "audio_limit": 192,
        "queue_priority": "free_consumer",
        "max_concurrent_jobs": 1,
        "retention_hours": 0,
        "rate_limit_bypass": False,
        "4k_allowed": False,
        "api_enabled": False,
        "bot_priority": "free",
        "history_enabled": False,
        "direct_delivery_allowed": True,
        "cost_tolerance_level": "low",
    },
    "free": {
        "plan": "free",
        "download_limit_daily": 5,
        "api_request_limit_daily": 0,
        "max_quality": 720,
        "audio_limit": 192,
        "queue_priority": "free_consumer",
        "max_concurrent_jobs": 1,
        "retention_hours": 24,
        "rate_limit_bypass": False,
        "4k_allowed": False,
        "api_enabled": False,
        "bot_priority": "free",
        "history_enabled": False,
        "direct_delivery_allowed": True,
        "cost_tolerance_level": "low",
    },
    "pro": {
        "plan": "pro",
        "download_limit_daily": 100,
        "api_request_limit_daily": 0,
        "max_quality": 1080,
        "audio_limit": 320,
        "queue_priority": "pro_consumer",
        "max_concurrent_jobs": 2,
        "retention_hours": 72,
        "rate_limit_bypass": False,
        "4k_allowed": False,
        "api_enabled": False,
        "bot_priority": "pro",
        "history_enabled": True,
        "direct_delivery_allowed": True,
        "cost_tolerance_level": "medium",
    },
    "premium": {
        "plan": "premium",
        "download_limit_daily": 500,
        "api_request_limit_daily": 0,
        "max_quality": 2160,
        "audio_limit": 320,
        "queue_priority": "premium_consumer",
        "max_concurrent_jobs": 3,
        "retention_hours": 72,
        "rate_limit_bypass": False,
        "4k_allowed": True,
        "api_enabled": False,
        "bot_priority": "premium",
        "history_enabled": True,
        "direct_delivery_allowed": True,
        "cost_tolerance_level": "high",
    },
    "api": {
        "plan": "api",
        "download_limit_daily": 0,
        "api_request_limit_daily": 5000,
        "max_quality": 1080,
        "audio_limit": 320,
        "queue_priority": "api_bulk",
        "max_concurrent_jobs": 3,
        "retention_hours": 72,
        "rate_limit_bypass": False,
        "4k_allowed": False,
        "api_enabled": True,
        "bot_priority": "pro",
        "history_enabled": True,
        "direct_delivery_allowed": True,
        "cost_tolerance_level": "medium",
    },
    "api_growth": {
        "plan": "api_growth",
        "download_limit_daily": 0,
        "api_request_limit_daily": 25000,
        "max_quality": 2160,
        "audio_limit": 320,
        "queue_priority": "api_bulk",
        "max_concurrent_jobs": 5,
        "retention_hours": 72,
        "rate_limit_bypass": False,
        "4k_allowed": True,
        "api_enabled": True,
        "bot_priority": "premium",
        "history_enabled": True,
        "direct_delivery_allowed": True,
        "cost_tolerance_level": "high",
    },
    "enterprise": {
        "plan": "enterprise",
        "download_limit_daily": 0,
        "api_request_limit_daily": 100000,
        "max_quality": 2160,
        "audio_limit": 320,
        "queue_priority": "api_bulk",
        "max_concurrent_jobs": 10,
        "retention_hours": 168,
        "rate_limit_bypass": False,
        "4k_allowed": True,
        "api_enabled": True,
        "bot_priority": "premium",
        "history_enabled": True,
        "direct_delivery_allowed": True,
        "cost_tolerance_level": "high",
    },
}


def normalize_plan(value: Any) -> str:
    plan = str(value or "").strip().lower()
    if plan in KNOWN_PLANS:
        return plan
    return "free"


def build_effective_entitlement(user: dict[str, Any] | None) -> dict[str, Any]:
    user = dict(user or {})
    role = str(user.get("role") or ("guest" if user.get("anonymous", True) else "user")).strip().lower()
    plan = normalize_plan(user.get("plan"))
    account_status = str(user.get("account_status") or "active").strip().lower()
    client_surface = str(user.get("client_surface") or "").strip().lower()

    if role == "guest" or user.get("anonymous"):
        plan_key = "extension_guest" if client_surface == "extension" else "guest"
    else:
        plan_key = plan
    entitlement = deepcopy(PLAN_DEFAULTS.get(plan_key, PLAN_DEFAULTS["free"]))

    if role == "admin":
        entitlement.update(
            {
                "queue_priority": "admin_priority",
                "download_limit_daily": 0,
                "api_request_limit_daily": 0,
                "rate_limit_bypass": True,
                "4k_allowed": True,
                "api_enabled": True,
                "bot_priority": "premium",
                "history_enabled": True,
                "cost_tolerance_level": "high",
            }
        )
    elif role == "owner":
        entitlement.update(
            {
                "queue_priority": "owner_priority",
                "download_limit_daily": 0,
                "api_request_limit_daily": 0,
                "max_quality": 2160,
                "max_concurrent_jobs": 999,
                "retention_hours": 168,
                "rate_limit_bypass": True,
                "4k_allowed": True,
                "api_enabled": True,
                "bot_priority": "premium",
                "history_enabled": True,
                "direct_delivery_allowed": True,
                "cost_tolerance_level": "unlimited",
            }
        )

    entitlement.update(
        {
            "role": role,
            "plan": entitlement["plan"],
            "account_status": account_status,
            "client_surface": client_surface or "web",
        }
    )

    bonus_download_credits = int(user.get("bonus_download_credits") or 0)
    bonus_api_credits = int(user.get("bonus_api_credits") or 0)

    if entitlement.get("download_limit_daily", 0) > 0 and bonus_download_credits > 0:
        entitlement["download_limit_daily"] = int(entitlement["download_limit_daily"]) + bonus_download_credits

    if bonus_api_credits > 0:
        base_api_limit = int(entitlement.get("api_request_limit_daily") or 0)
        entitlement["api_request_limit_daily"] = base_api_limit + bonus_api_credits
        entitlement["api_enabled"] = True

    entitlement["bonus_download_credits"] = bonus_download_credits
    entitlement["bonus_api_credits"] = bonus_api_credits
    return entitlement


def is_owner_role(role: Any) -> bool:
    return str(role or "").strip().lower() in OWNER_ROLES
