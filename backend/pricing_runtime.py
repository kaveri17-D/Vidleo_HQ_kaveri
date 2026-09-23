from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from backend.api_v1.middleware import _get_redis_client, ensure_redis_or_fail

PRICING_ELITE_BASE_KEY = "pricing:elite:monthly:base"
PRICING_ELITE_CURRENT_KEY = "pricing:elite:monthly:current"
PRICING_SALE_IS_ACTIVE_KEY = "pricing:sale:is_active"
PRICING_SALE_MESSAGE_KEY = "pricing:sale:message"
PRICING_SALE_END_TIMESTAMP_KEY = "pricing:sale:end_timestamp"
PRICING_META_KEY = "pricing:meta"
_UNSET = object()

DEFAULT_ELITE_BASE = max(99, int(os.environ.get("PRICING_ELITE_MONTHLY_BASE", "999") or 999))
MIN_ELITE_THRESHOLD = max(99, int(os.environ.get("PRICING_ELITE_MIN_THRESHOLD", "99") or 99))
DEFAULT_ELITE_CURRENT = max(
    MIN_ELITE_THRESHOLD,
    int(os.environ.get("PRICING_ELITE_MONTHLY_CURRENT", "499") or 499),
)


def _coerce_int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(fallback)


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    normalized = str(value or "").strip().lower()
    return normalized in {"1", "true", "yes", "on"}


def _pricing_defaults() -> dict[str, Any]:
    return {
        "elite_monthly": {
            "base": DEFAULT_ELITE_BASE,
            "current": DEFAULT_ELITE_CURRENT,
            "minimum_threshold": MIN_ELITE_THRESHOLD,
            "currency_code": "INR",
        },
        "sale": {
            "is_active": False,
            "message": "",
            "end_timestamp": None,
        },
        "updated_at": None,
        "updated_by": None,
        "redis_available": False,
    }


def _normalize_current_price(current: int) -> int:
    return max(MIN_ELITE_THRESHOLD, int(current))


async def get_pricing_snapshot() -> dict[str, Any]:
    snapshot = _pricing_defaults()
    redis_client = _get_redis_client()
    if redis_client is None:
        return snapshot

    try:
        base_raw = await redis_client.get(PRICING_ELITE_BASE_KEY)
        current_raw = await redis_client.get(PRICING_ELITE_CURRENT_KEY)
        sale_active_raw = await redis_client.get(PRICING_SALE_IS_ACTIVE_KEY)
        sale_message_raw = await redis_client.get(PRICING_SALE_MESSAGE_KEY)
        sale_end_raw = await redis_client.get(PRICING_SALE_END_TIMESTAMP_KEY)
        meta_raw = await redis_client.get(PRICING_META_KEY)
    except Exception:
        return snapshot

    base = max(MIN_ELITE_THRESHOLD, _coerce_int(base_raw, DEFAULT_ELITE_BASE))
    sale_active = _coerce_bool(sale_active_raw)
    current = _normalize_current_price(_coerce_int(current_raw, DEFAULT_ELITE_CURRENT))

    snapshot["redis_available"] = True
    snapshot["elite_monthly"]["base"] = base
    snapshot["elite_monthly"]["current"] = current
    snapshot["sale"]["is_active"] = sale_active
    snapshot["sale"]["message"] = str(sale_message_raw or "").strip()

    end_timestamp = _coerce_int(sale_end_raw, 0)
    snapshot["sale"]["end_timestamp"] = end_timestamp if end_timestamp > 0 else None

    if meta_raw:
        try:
            meta = json.loads(meta_raw)
            if isinstance(meta, dict):
                snapshot["updated_at"] = meta.get("updated_at")
                snapshot["updated_by"] = meta.get("updated_by")
        except Exception:
            pass

    return snapshot


async def update_pricing_settings(
    *,
    elite_monthly_base: int | None = None,
    elite_monthly_current: int | None = None,
    sale_is_active: bool | None = None,
    sale_message: str | None = None,
    sale_end_timestamp: int | None | object = _UNSET,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    redis_client = await ensure_redis_or_fail()
    current = await get_pricing_snapshot()

    next_base = max(
        MIN_ELITE_THRESHOLD,
        int(elite_monthly_base if elite_monthly_base is not None else current["elite_monthly"]["base"]),
    )
    next_sale_active = (
        bool(sale_is_active)
        if sale_is_active is not None
        else bool(current["sale"]["is_active"])
    )
    next_current_seed = elite_monthly_current if elite_monthly_current is not None else current["elite_monthly"]["current"]
    next_current = _normalize_current_price(int(next_current_seed))
    next_message = (
        str(sale_message).strip()
        if sale_message is not None
        else str(current["sale"]["message"] or "").strip()
    )

    end_timestamp_value = (
        _coerce_int(current["sale"]["end_timestamp"], 0)
        if sale_end_timestamp is _UNSET
        else _coerce_int(sale_end_timestamp, 0)
    )

    pipeline = redis_client.pipeline()
    pipeline.set(PRICING_ELITE_BASE_KEY, next_base)
    pipeline.set(PRICING_ELITE_CURRENT_KEY, next_current)
    pipeline.set(PRICING_SALE_IS_ACTIVE_KEY, "1" if next_sale_active else "0")

    if next_message:
        pipeline.set(PRICING_SALE_MESSAGE_KEY, next_message)
    else:
        pipeline.delete(PRICING_SALE_MESSAGE_KEY)

    if end_timestamp_value > 0:
        pipeline.set(PRICING_SALE_END_TIMESTAMP_KEY, end_timestamp_value)
    else:
        pipeline.delete(PRICING_SALE_END_TIMESTAMP_KEY)

    pipeline.set(
        PRICING_META_KEY,
        json.dumps(
            {
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": actor_user_id,
            }
        ),
    )
    await pipeline.execute()
    return await get_pricing_snapshot()


def pricing_preview_charge_inr(pricing_snapshot: dict[str, Any] | None) -> int:
    snapshot = pricing_snapshot or _pricing_defaults()
    elite = snapshot.get("elite_monthly") or {}
    sale = snapshot.get("sale") or {}
    if bool(sale.get("is_active")):
        return max(MIN_ELITE_THRESHOLD, int(elite.get("current") or elite.get("base") or DEFAULT_ELITE_BASE))
    return max(MIN_ELITE_THRESHOLD, int(elite.get("base") or DEFAULT_ELITE_BASE))


def pricing_preview_charge_usd_cents(pricing_snapshot: dict[str, Any] | None) -> int:
    # Mirrors INR integer -> USD cents, so 499 => $4.99
    return pricing_preview_charge_inr(pricing_snapshot)
