from __future__ import annotations

import datetime
import os
from copy import deepcopy
from typing import Any

from backend.entitlements import PLAN_DEFAULTS, build_effective_entitlement, normalize_plan

BOT_DOWNLOADS: dict[str, dict[int, dict[str, int | str]]] = {}


def _configured_plan(platform: str) -> str:
    raw = (
        os.environ.get(f"NEXUS_{platform.upper()}_BOT_PLAN")
        or os.environ.get("NEXUS_BOT_PLAN")
        or "guest"
    )
    plan = str(raw).strip().lower()
    if plan == "guest":
        return "guest"
    return normalize_plan(plan)


def _configured_limit(platform: str, fallback: int) -> int:
    for key in (f"NEXUS_{platform.upper()}_BOT_DAILY_LIMIT", "NEXUS_BOT_DAILY_LIMIT"):
        raw = os.environ.get(key)
        if not raw:
            continue
        try:
            return max(0, int(raw))
        except ValueError:
            continue
    return max(0, int(fallback))


def resolve_bot_policy(platform: str, *, is_owner: bool = False) -> dict[str, Any]:
    if is_owner:
        entitlement = build_effective_entitlement({"anonymous": False, "role": "owner", "plan": "enterprise"})
        entitlement["daily_success_limit"] = 0
        entitlement["policy_source"] = "owner"
        entitlement["platform"] = platform
        return entitlement

    plan_key = _configured_plan(platform)
    base = deepcopy(PLAN_DEFAULTS.get(plan_key, PLAN_DEFAULTS["guest"]))
    base["daily_success_limit"] = _configured_limit(platform, int(base.get("download_limit_daily") or 0))
    base["policy_source"] = plan_key
    base["platform"] = platform
    return base


def _today_record(platform: str, user_id: int) -> dict[str, int | str]:
    platform_store = BOT_DOWNLOADS.setdefault(platform, {})
    today = datetime.date.today().isoformat()
    record = platform_store.get(user_id)
    if not record or record.get("date") != today:
        record = {"count": 0, "date": today}
        platform_store[user_id] = record
    return record


def get_download_gate(platform: str, user_id: int, *, is_owner: bool = False) -> tuple[bool, dict[str, Any], int | None]:
    policy = resolve_bot_policy(platform, is_owner=is_owner)
    limit = int(policy.get("daily_success_limit") or 0)
    if is_owner or limit <= 0:
        return True, policy, None

    record = _today_record(platform, user_id)
    remaining = max(limit - int(record["count"]), 0)
    return remaining > 0, policy, remaining


def record_successful_download(platform: str, user_id: int, *, is_owner: bool = False) -> tuple[dict[str, Any], int | None]:
    policy = resolve_bot_policy(platform, is_owner=is_owner)
    limit = int(policy.get("daily_success_limit") or 0)
    if is_owner or limit <= 0:
        return policy, None

    record = _today_record(platform, user_id)
    record["count"] = int(record["count"]) + 1
    remaining = max(limit - int(record["count"]), 0)
    return policy, remaining


def daily_limit_label(policy: dict[str, Any]) -> str:
    limit = int(policy.get("daily_success_limit") or 0)
    return "unlimited" if limit <= 0 else str(limit)


def apply_bot_entitlement_filters(formats: list[dict[str, Any]], policy: dict[str, Any]) -> list[dict[str, Any]]:
    max_quality = int(policy.get("max_quality") or 0)
    filtered: list[dict[str, Any]] = []
    for item in formats:
        if item.get("type") == "video":
            height = int(item.get("height") or 0)
            if max_quality and height and height > max_quality:
                continue
        filtered.append(item)
    return filtered


def bot_limit_notice(platform_label: str, policy: dict[str, Any]) -> str:
    limit = daily_limit_label(policy)
    if limit == "unlimited":
        return f"{platform_label} owner lane is active."
    return (
        f"{platform_label} anonymous lane allows {limit} successful deliveries per day, "
        f"up to {policy.get('max_quality')}p video and any available audio quality, "
        "Use the NEXUS website login and paid plans for higher lanes."
    )
