from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from backend.api_v1.middleware import _get_redis_client, ensure_redis_or_fail

CAMPAIGN_ACTIVE_MESSAGE_KEY = "campaign:active_message"
CAMPAIGN_LIMIT_FREE_KEY = "campaign:limit:free"
CAMPAIGN_LIMIT_PRO_KEY = "campaign:limit:pro"
CAMPAIGN_QUALITY_FREE_KEY = "campaign:quality:free"
CAMPAIGN_QUALITY_PRO_KEY = "campaign:quality:pro"
CAMPAIGN_META_KEY = "campaign:meta"
USER_OVERRIDE_LIMIT_KEY_TEMPLATE = "user_override:{user_id}:limit"
USER_OVERRIDE_QUALITY_KEY_TEMPLATE = "user_override:{user_id}:quality"

QUALITY_OPTIONS = ["144p", "360p", "720p", "1080p", "4k", "audio"]
PRO_PLANS = {"pro", "premium", "api", "api_growth", "enterprise"}


def _normalize_limit(value: Any, fallback: int) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return max(0, int(fallback))


def _normalize_quality_token(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    mapping = {
        "144": "144p",
        "144p": "144p",
        "360": "360p",
        "360p": "360p",
        "720": "720p",
        "720p": "720p",
        "1080": "1080p",
        "1080p": "1080p",
        "4k": "4k",
        "2160": "4k",
        "2160p": "4k",
        "audio": "audio",
        "audio-only": "audio",
        "audio_only": "audio",
    }
    return mapping.get(normalized)


def _normalize_quality_list(values: Any, fallback: list[str]) -> list[str]:
    raw_values: list[Any]
    if values is None:
        raw_values = []
    elif isinstance(values, str):
        raw_values = [item.strip() for item in values.split(",")]
    elif isinstance(values, (list, tuple, set)):
        raw_values = list(values)
    else:
        raw_values = [values]

    normalized: list[str] = []
    for item in raw_values:
        token = _normalize_quality_token(item)
        if token and token not in normalized:
            normalized.append(token)

    return normalized or list(fallback)


DEFAULT_FREE_LIMIT = _normalize_limit(os.environ.get("CAMPAIGN_DEFAULT_FREE_LIMIT"), 10)
DEFAULT_PRO_LIMIT = _normalize_limit(os.environ.get("CAMPAIGN_DEFAULT_PRO_LIMIT"), 100)
DEFAULT_FREE_QUALITIES = _normalize_quality_list(
    os.environ.get("CAMPAIGN_DEFAULT_FREE_QUALITIES"),
    ["144p", "360p", "720p", "audio"],
)
DEFAULT_PRO_QUALITIES = _normalize_quality_list(
    os.environ.get("CAMPAIGN_DEFAULT_PRO_QUALITIES"),
    ["144p", "360p", "720p", "1080p", "4k", "audio"],
)


def _user_override_limit_key(user_id: str) -> str:
    return USER_OVERRIDE_LIMIT_KEY_TEMPLATE.format(user_id=str(user_id))


def _user_override_quality_key(user_id: str) -> str:
    return USER_OVERRIDE_QUALITY_KEY_TEMPLATE.format(user_id=str(user_id))


def resolve_campaign_tier(plan: str | None) -> str:
    normalized = str(plan or "").strip().lower()
    return "pro" if normalized in PRO_PLANS else "free"


def _current_defaults() -> dict[str, Any]:
    return {
        "active_message": "",
        "limit": {
            "free": DEFAULT_FREE_LIMIT,
            "pro": DEFAULT_PRO_LIMIT,
        },
        "quality": {
            "free": list(DEFAULT_FREE_QUALITIES),
            "pro": list(DEFAULT_PRO_QUALITIES),
        },
        "updated_at": None,
        "updated_by": None,
        "redis_available": False,
        "overrides": [],
    }


async def _safe_list_values(redis_client, key: str) -> list[str]:
    try:
        values = await redis_client.lrange(key, 0, -1)
    except Exception:
        return []
    return _normalize_quality_list(values, [])


async def get_campaign_snapshot(*, include_overrides: bool = False) -> dict[str, Any]:
    snapshot = _current_defaults()
    redis_client = _get_redis_client()
    if redis_client is None:
        return snapshot

    try:
        active_message = await redis_client.get(CAMPAIGN_ACTIVE_MESSAGE_KEY)
        free_limit = await redis_client.get(CAMPAIGN_LIMIT_FREE_KEY)
        pro_limit = await redis_client.get(CAMPAIGN_LIMIT_PRO_KEY)
        free_qualities = await _safe_list_values(redis_client, CAMPAIGN_QUALITY_FREE_KEY)
        pro_qualities = await _safe_list_values(redis_client, CAMPAIGN_QUALITY_PRO_KEY)
        raw_meta = await redis_client.get(CAMPAIGN_META_KEY)
    except Exception:
        return snapshot

    snapshot["redis_available"] = True
    snapshot["active_message"] = str(active_message or "").strip()
    snapshot["limit"]["free"] = _normalize_limit(free_limit, DEFAULT_FREE_LIMIT)
    snapshot["limit"]["pro"] = _normalize_limit(pro_limit, DEFAULT_PRO_LIMIT)
    snapshot["quality"]["free"] = free_qualities or list(DEFAULT_FREE_QUALITIES)
    snapshot["quality"]["pro"] = pro_qualities or list(DEFAULT_PRO_QUALITIES)

    if raw_meta:
        try:
            if isinstance(raw_meta, str):
                meta = json.loads(raw_meta)
            else:
                meta = raw_meta
            if isinstance(meta, dict):
                snapshot["updated_at"] = meta.get("updated_at")
                snapshot["updated_by"] = meta.get("updated_by")
        except Exception:
            pass

    if include_overrides:
        snapshot["overrides"] = await list_user_overrides()

    return snapshot


async def update_campaign_settings(
    *,
    active_message: str | None = None,
    free_limit: int | None = None,
    pro_limit: int | None = None,
    free_qualities: list[str] | None = None,
    pro_qualities: list[str] | None = None,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    redis_client = await ensure_redis_or_fail()
    pipeline = redis_client.pipeline()

    if active_message is not None:
        cleaned = str(active_message).strip()
        if cleaned:
            pipeline.set(CAMPAIGN_ACTIVE_MESSAGE_KEY, cleaned)
        else:
            pipeline.delete(CAMPAIGN_ACTIVE_MESSAGE_KEY)

    if free_limit is not None:
        pipeline.set(CAMPAIGN_LIMIT_FREE_KEY, _normalize_limit(free_limit, DEFAULT_FREE_LIMIT))

    if pro_limit is not None:
        pipeline.set(CAMPAIGN_LIMIT_PRO_KEY, _normalize_limit(pro_limit, DEFAULT_PRO_LIMIT))

    if free_qualities is not None:
        normalized_free = _normalize_quality_list(free_qualities, DEFAULT_FREE_QUALITIES)
        pipeline.delete(CAMPAIGN_QUALITY_FREE_KEY)
        if normalized_free:
            pipeline.rpush(CAMPAIGN_QUALITY_FREE_KEY, *normalized_free)

    if pro_qualities is not None:
        normalized_pro = _normalize_quality_list(pro_qualities, DEFAULT_PRO_QUALITIES)
        pipeline.delete(CAMPAIGN_QUALITY_PRO_KEY)
        if normalized_pro:
            pipeline.rpush(CAMPAIGN_QUALITY_PRO_KEY, *normalized_pro)

    pipeline.set(
        CAMPAIGN_META_KEY,
        json.dumps(
            {
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": actor_user_id,
            }
        ),
    )
    await pipeline.execute()
    return await get_campaign_snapshot(include_overrides=True)


async def get_user_override(user_id: str | int) -> dict[str, Any]:
    identifier = str(user_id).strip()
    override = {
        "user_id": identifier,
        "limit": None,
        "quality": [],
    }
    if not identifier:
        return override

    redis_client = _get_redis_client()
    if redis_client is None:
        return override

    try:
        limit_raw = await redis_client.get(_user_override_limit_key(identifier))
        quality_values = await _safe_list_values(redis_client, _user_override_quality_key(identifier))
    except Exception:
        return override

    if limit_raw is not None:
        override["limit"] = _normalize_limit(limit_raw, DEFAULT_FREE_LIMIT)
    if quality_values:
        override["quality"] = quality_values
    return override


async def set_user_override(
    user_id: str | int,
    *,
    limit: int | None = None,
    quality: list[str] | None = None,
    remove: bool = False,
) -> dict[str, Any]:
    identifier = str(user_id).strip()
    if not identifier:
        raise ValueError("user_id is required")

    redis_client = await ensure_redis_or_fail()
    pipeline = redis_client.pipeline()
    limit_key = _user_override_limit_key(identifier)
    quality_key = _user_override_quality_key(identifier)

    if remove:
        pipeline.delete(limit_key)
        pipeline.delete(quality_key)
        await pipeline.execute()
        return {"user_id": identifier, "limit": None, "quality": []}

    if limit is not None:
        pipeline.set(limit_key, _normalize_limit(limit, DEFAULT_FREE_LIMIT))
    if quality is not None:
        normalized_quality = _normalize_quality_list(quality, [])
        pipeline.delete(quality_key)
        if normalized_quality:
            pipeline.rpush(quality_key, *normalized_quality)

    await pipeline.execute()
    return await get_user_override(identifier)


async def list_user_overrides(limit: int = 100) -> list[dict[str, Any]]:
    redis_client = _get_redis_client()
    if redis_client is None:
        return []

    try:
        user_ids: set[str] = set()
        async for key in redis_client.scan_iter(match="user_override:*:limit"):
            parts = str(key).split(":")
            if len(parts) >= 3:
                user_ids.add(parts[1])
        async for key in redis_client.scan_iter(match="user_override:*:quality"):
            parts = str(key).split(":")
            if len(parts) >= 3:
                user_ids.add(parts[1])
    except Exception:
        return []

    rows: list[dict[str, Any]] = []
    for user_id in sorted(user_ids):
        rows.append(await get_user_override(user_id))
        if len(rows) >= limit:
            break
    return rows


async def resolve_campaign_access(
    *,
    user_id: str | int,
    plan: str | None = None,
    is_owner: bool = False,
) -> dict[str, Any]:
    if is_owner:
        return {
            "tier": "pro",
            "limit": 0,
            "quality": list(QUALITY_OPTIONS),
            "source": "owner",
        }

    tier = resolve_campaign_tier(plan)
    snapshot = await get_campaign_snapshot()
    override = await get_user_override(user_id)

    limit = override.get("limit")
    if limit is None:
        limit = int((snapshot.get("limit") or {}).get(tier) or DEFAULT_FREE_LIMIT)

    quality = list(override.get("quality") or [])
    if not quality:
        quality = list((snapshot.get("quality") or {}).get(tier) or DEFAULT_FREE_QUALITIES)

    return {
        "tier": tier,
        "limit": _normalize_limit(limit, DEFAULT_FREE_LIMIT),
        "quality": _normalize_quality_list(quality, DEFAULT_FREE_QUALITIES if tier == "free" else DEFAULT_PRO_QUALITIES),
        "source": "override" if override.get("limit") is not None or override.get("quality") else "campaign",
    }


def filter_formats_by_campaign(formats: list[dict[str, Any]], allowed_qualities: list[str] | None) -> list[dict[str, Any]]:
    normalized_allowed = _normalize_quality_list(allowed_qualities, [])
    if not normalized_allowed:
        return list(formats)

    filtered: list[dict[str, Any]] = []
    for item in formats:
        media_type = str(item.get("type") or "").strip().lower()
        if media_type == "audio":
            if "audio" in normalized_allowed:
                filtered.append(item)
            continue

        height = int(item.get("height") or 0)
        token = None
        if height >= 2160:
            token = "4k"
        elif height >= 1080:
            token = "1080p"
        elif height >= 720:
            token = "720p"
        elif height >= 360:
            token = "360p"
        elif height >= 144:
            token = "144p"

        if token and token in normalized_allowed:
            filtered.append(item)

    return filtered


def format_campaign_message(message: str | None) -> str:
    cleaned = str(message or "").strip()
    return cleaned[:500]
