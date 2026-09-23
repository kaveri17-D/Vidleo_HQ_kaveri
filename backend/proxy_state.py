from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any
from urllib.parse import urlparse

try:
    import redis
except Exception:  # pragma: no cover - optional at runtime
    redis = None

from backend.supabase_client import create_client

# =============================================================================
# BULLET PROOF ARCHITECTURE: 
# NO IN-MEMORY FALLBACK. IF REDIS DIES, WE FAIL-SAFE AND PAUSE GLOBALLY.
# =============================================================================

# ── Elite Concurrency Doctrine: Connection Pool Warming ──────────────────────
# True lazy singletons — created once, reused forever.
# Sentinel: None = not yet tried, False = tried and permanently failed.
_SUPABASE_SINGLETON = None
_REDIS_SINGLETON = None


def _get_supabase():
    global _SUPABASE_SINGLETON
    if _SUPABASE_SINGLETON is False:
        return None
    if _SUPABASE_SINGLETON is not None:
        return _SUPABASE_SINGLETON
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        _SUPABASE_SINGLETON = False
        return None
    try:
        _SUPABASE_SINGLETON = create_client(url, key)
        return _SUPABASE_SINGLETON
    except Exception:
        _SUPABASE_SINGLETON = False
        return None


def _get_sync_redis():
    global _REDIS_SINGLETON
    if _REDIS_SINGLETON is False:
        return None
    if _REDIS_SINGLETON is not None:
        return _REDIS_SINGLETON
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url or redis is None:
        _REDIS_SINGLETON = False
        return None
    try:
        client = redis.Redis.from_url(redis_url, decode_responses=True)
        client.ping()
        _REDIS_SINGLETON = client
        return _REDIS_SINGLETON
    except Exception:
        _REDIS_SINGLETON = False
        return None


def _proxy_endpoint() -> str | None:
    return os.environ.get("RESIDENTIAL_PROXY_URL") or os.environ.get("PROXY_URL")


def _masked_proxy(proxy_url: str | None) -> str | None:
    if not proxy_url:
        return None
    digest = hashlib.sha256(proxy_url.encode("utf-8")).hexdigest()[:12]
    return f"configured:{digest}"


def _burn_ttl_seconds() -> int:
    return max(60, int(os.environ.get("PROXY_BURN_TTL_SECONDS", "900")))


def _recovery_probe_interval_seconds() -> int:
    return max(3600, int(os.environ.get("PROXY_AUTO_RECOVERY_INTERVAL_SECONDS", "7200")))


def _half_open_probe_budget() -> int:
    return max(1, int(os.environ.get("PROXY_HALF_OPEN_TEST_PROBES", "5")))


def _breaker_min_probes() -> int:
    return max(1, int(os.environ.get("PROXY_BREAKER_MIN_PROBES", "50")))


def _breaker_min_success_rate_pct() -> float:
    return max(0.0, float(os.environ.get("PROXY_BREAKER_MIN_SUCCESS_RATE_PCT", "65") or 65))


def _breaker_max_burn_rate_per_1k() -> float:
    return max(0.0, float(os.environ.get("PROXY_BREAKER_MAX_BURN_RATE_PER_1K", "200") or 200))


def _breaker_escalation_window_hours() -> int:
    return max(1, int(os.environ.get("PROXY_BREAKER_ESCALATION_WINDOW_HOURS", "24")))


def _breaker_escalation_max_cooldown_seconds() -> int:
    return max(_recovery_probe_interval_seconds(), int(os.environ.get("PROXY_BREAKER_ESCALATION_MAX_COOLDOWN_SECONDS", "86400")))


def _breaker_hard_quarantine_min_trips() -> int:
    return max(4, int(os.environ.get("PROXY_BREAKER_HARD_QUARANTINE_MIN_TRIPS", "6")))


def _breaker_hard_quarantine_seconds() -> int:
    return max(
        _breaker_escalation_max_cooldown_seconds(),
        int(os.environ.get("PROXY_BREAKER_HARD_QUARANTINE_SECONDS", "172800")),
    )


def _proxy_provider_costs() -> dict[str, float]:
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


YOUTUBE_PROXY_POOL_RING_KEY = "nexus:proxy_pool:v1:ring"
YOUTUBE_PROXY_POOL_META_KEY = "nexus:proxy_pool:v1:meta"
YOUTUBE_PROXY_POOL_PROXY_KEY_PREFIX = "nexus:proxy_pool:v1:proxy:"


def _youtube_proxy_pool_burn_ttl_seconds() -> int:
    return max(60, int(os.environ.get("PROXY_POOL_BURN_TTL_SECONDS", "900")))


def _youtube_proxy_pool_raw() -> str:
    raw = os.environ.get("YOUTUBE_PROXY_POOL", "").strip() or os.environ.get("RESIDENTIAL_PROXY_POOL", "").strip()
    if raw:
        return raw
    fallback = os.environ.get("RESIDENTIAL_PROXY_URL", "").strip() or os.environ.get("PROXY_URL", "").strip()
    return fallback


def _youtube_proxy_pool_entries() -> list[str]:
    raw = _youtube_proxy_pool_raw()
    if not raw:
        return []
    entries: list[str] = []
    seen: set[str] = set()
    for item in raw.split(","):
        proxy = item.strip().strip('"').strip("'")
        if not proxy:
            continue
        if not proxy.startswith(("http://", "https://", "socks5://", "socks5h://")):
            proxy = f"http://{proxy}"
        if proxy in seen:
            continue
        seen.add(proxy)
        entries.append(proxy)
    return entries


def _youtube_proxy_pool_hash(entries: list[str]) -> str:
    return hashlib.sha256(",".join(entries).encode("utf-8")).hexdigest()


def _youtube_proxy_id(proxy_url: str) -> str:
    return hashlib.sha256(proxy_url.encode("utf-8")).hexdigest()[:12]


def _youtube_proxy_stats_key(proxy_url: str) -> str:
    return f"{YOUTUBE_PROXY_POOL_PROXY_KEY_PREFIX}{_youtube_proxy_id(proxy_url)}"


def _youtube_proxy_endpoint_hint(proxy_url: str) -> str:
    parsed = urlparse(proxy_url)
    host = parsed.hostname or "unknown"
    port = parsed.port
    return f"{host}:{port}" if port else host


def _youtube_proxy_cost_per_1000() -> float:
    provider_costs = _proxy_provider_costs()
    if "youtube" in provider_costs:
        return float(provider_costs["youtube"])
    return float(os.environ.get("PROXY_COST_PER_1000_PROBES", "0") or 0.0)


def _ensure_youtube_proxy_pool_loaded() -> dict[str, Any]:
    client = _get_sync_redis()
    entries = _youtube_proxy_pool_entries()
    if client is None:
        return {"configured": bool(entries), "redis_available": False, "pool_size": len(entries)}

    pool_hash = _youtube_proxy_pool_hash(entries) if entries else ""
    try:
        meta = client.hgetall(YOUTUBE_PROXY_POOL_META_KEY) or {}
        current_hash = str(meta.get("pool_hash") or "")
        current_size = int(meta.get("pool_size") or 0)
        ring_size = int(client.llen(YOUTUBE_PROXY_POOL_RING_KEY) or 0)
        paused = str(meta.get("paused") or "0")

        if not entries:
            pipe = client.pipeline()
            pipe.delete(YOUTUBE_PROXY_POOL_RING_KEY)
            pipe.hset(
                YOUTUBE_PROXY_POOL_META_KEY,
                mapping={
                    "pool_hash": "",
                    "pool_size": 0,
                    "paused": paused,
                    "updated_at": int(time.time()),
                },
            )
            pipe.execute()
            return {"configured": False, "redis_available": True, "pool_size": 0}

        if current_hash == pool_hash and current_size == len(entries) and ring_size == len(entries):
            return {"configured": True, "redis_available": True, "pool_size": len(entries)}

        pipe = client.pipeline()
        pipe.delete(YOUTUBE_PROXY_POOL_RING_KEY)
        if entries:
            pipe.rpush(YOUTUBE_PROXY_POOL_RING_KEY, *entries)
        pipe.hset(
            YOUTUBE_PROXY_POOL_META_KEY,
            mapping={
                "pool_hash": pool_hash,
                "pool_size": len(entries),
                "paused": paused,
                "updated_at": int(time.time()),
            },
        )
        for proxy_url in entries:
            stats_key = _youtube_proxy_stats_key(proxy_url)
            if not client.exists(stats_key):
                pipe.hset(
                    stats_key,
                    mapping={
                        "proxy_id": _youtube_proxy_id(proxy_url),
                        "endpoint_hint": _youtube_proxy_endpoint_hint(proxy_url),
                        "paused": 0,
                        "success_count": 0,
                        "failure_count": 0,
                        "rejection_count": 0,
                        "burn_events": 0,
                        "total_probes": 0,
                        "burned_until": 0,
                        "last_state": "ready",
                    },
                )
            else:
                pipe.hset(
                    stats_key,
                    mapping={
                        "proxy_id": _youtube_proxy_id(proxy_url),
                        "endpoint_hint": _youtube_proxy_endpoint_hint(proxy_url),
                    },
                )
        pipe.execute()
    except Exception:
        return {"configured": bool(entries), "redis_available": False, "pool_size": len(entries)}

    return {"configured": bool(entries), "redis_available": True, "pool_size": len(entries)}


def _youtube_proxy_is_bot_failure(reason: str | None) -> bool:
    lowered = str(reason or "").lower()
    return any(
        token in lowered
        for token in (
            "429",
            "sign in to confirm",
            "not a bot",
            "anti-bot",
            "youtube_antibot_triggered",
            "captcha",
            "rate limit",
            "too many requests",
            "requested format is not available",
        )
    )


def acquire_youtube_proxy() -> dict[str, Any]:
    client = _get_sync_redis()
    bootstrap = _ensure_youtube_proxy_pool_loaded()
    if client is None:
        return {"configured": bool(bootstrap.get("configured")), "available": False, "reason": "redis_unavailable"}
    if not bootstrap.get("configured"):
        return {"configured": False, "available": False, "reason": "unconfigured"}

    try:
        meta = client.hgetall(YOUTUBE_PROXY_POOL_META_KEY) or {}
        if str(meta.get("paused") or "0") == "1":
            return {"configured": True, "available": False, "reason": "paused"}

        ring_size = int(client.llen(YOUTUBE_PROXY_POOL_RING_KEY) or 0)
        if ring_size <= 0:
            return {"configured": True, "available": False, "reason": "ring_empty"}

        now = int(time.time())
        for _ in range(ring_size):
            proxy_url = client.rpoplpush(YOUTUBE_PROXY_POOL_RING_KEY, YOUTUBE_PROXY_POOL_RING_KEY)
            if not proxy_url:
                break
            stats_key = _youtube_proxy_stats_key(proxy_url)
            stats = client.hgetall(stats_key) or {}
            paused = str(stats.get("paused") or "0") == "1"
            burned_until = int(stats.get("burned_until") or 0)
            if paused or burned_until > now:
                continue

            client.hset(
                stats_key,
                mapping={
                    "last_allocated_at": now,
                    "last_state": "allocated",
                },
            )
            client.hset(
                YOUTUBE_PROXY_POOL_META_KEY,
                mapping={
                    "last_rotation_at": now,
                    "last_allocated_proxy_id": _youtube_proxy_id(proxy_url),
                },
            )
            return {
                "configured": True,
                "available": True,
                "proxy_url": proxy_url,
                "proxy_id": _youtube_proxy_id(proxy_url),
                "endpoint_hint": _youtube_proxy_endpoint_hint(proxy_url),
            }
    except Exception:
        return {"configured": True, "available": False, "reason": "redis_error"}

    return {"configured": True, "available": False, "reason": "all_burned_or_paused"}


def record_youtube_proxy_result(proxy_url: str, *, success: bool, reason: str | None = None) -> None:
    client = _get_sync_redis()
    if client is None or not proxy_url:
        return

    _ensure_youtube_proxy_pool_loaded()
    now = int(time.time())
    stats_key = _youtube_proxy_stats_key(proxy_url)
    endpoint_hint = _youtube_proxy_endpoint_hint(proxy_url)
    bot_failure = _youtube_proxy_is_bot_failure(reason)

    try:
        pipe = client.pipeline()
        pipe.hset(
            stats_key,
            mapping={
                "proxy_id": _youtube_proxy_id(proxy_url),
                "endpoint_hint": endpoint_hint,
                "last_error": reason or "",
                "last_state": "healthy" if success else ("burned" if bot_failure else "failed"),
            },
        )
        pipe.hincrby(stats_key, "total_probes", 1)
        if success:
            pipe.hincrby(stats_key, "success_count", 1)
            pipe.hset(
                stats_key,
                mapping={
                    "last_success_at": now,
                    "burned_until": 0,
                    "consecutive_failures": 0,
                },
            )
        else:
            pipe.hincrby(stats_key, "failure_count", 1)
            pipe.hincrby(stats_key, "consecutive_failures", 1)
            pipe.hset(stats_key, mapping={"last_failure_at": now})
            if bot_failure:
                pipe.hincrby(stats_key, "rejection_count", 1)
                pipe.hincrby(stats_key, "burn_events", 1)
                pipe.hset(stats_key, mapping={"burned_until": now + _youtube_proxy_pool_burn_ttl_seconds()})
        pipe.execute()
    except Exception:
        return


def run_youtube_proxy_pool_action(action: str, *, reason: str | None = None) -> dict[str, Any]:
    client = _get_sync_redis()
    bootstrap = _ensure_youtube_proxy_pool_loaded()
    entries = _youtube_proxy_pool_entries()
    if client is None:
        return {"status": "skipped", "reason": "redis_unavailable", "pool": get_youtube_proxy_pool_stats()}

    action_key = str(action or "").strip().lower()
    now = int(time.time())
    try:
        if action_key == "force_rotate":
            rotated = client.rpoplpush(YOUTUBE_PROXY_POOL_RING_KEY, YOUTUBE_PROXY_POOL_RING_KEY)
            client.hset(
                YOUTUBE_PROXY_POOL_META_KEY,
                mapping={
                    "last_rotation_at": now,
                    "last_operator_action": "force_rotate",
                },
            )
            return {
                "status": "ok",
                "action": action_key,
                "selected_proxy": _youtube_proxy_endpoint_hint(rotated) if rotated else None,
                "reason": reason,
                "pool": get_youtube_proxy_pool_stats(),
            }

        if action_key in {"pause_youtube_traffic", "resume_youtube_traffic"}:
            paused_value = "1" if action_key == "pause_youtube_traffic" else "0"
            client.hset(
                YOUTUBE_PROXY_POOL_META_KEY,
                mapping={
                    "paused": paused_value,
                    "last_operator_action": action_key,
                    "updated_at": now,
                },
            )
            return {"status": "ok", "action": action_key, "reason": reason, "pool": get_youtube_proxy_pool_stats()}

        if action_key == "reset_burn_stats":
            pipe = client.pipeline()
            for proxy_url in entries:
                pipe.hset(
                    _youtube_proxy_stats_key(proxy_url),
                    mapping={
                        "failure_count": 0,
                        "rejection_count": 0,
                        "burn_events": 0,
                        "burned_until": 0,
                        "consecutive_failures": 0,
                        "last_error": "",
                        "last_state": "ready",
                    },
                )
            pipe.hset(
                YOUTUBE_PROXY_POOL_META_KEY,
                mapping={
                    "last_operator_action": action_key,
                    "updated_at": now,
                },
            )
            pipe.execute()
            return {"status": "ok", "action": action_key, "reason": reason, "pool": get_youtube_proxy_pool_stats()}
    except Exception:
        return {"status": "error", "action": action_key, "reason": "redis_error", "pool": get_youtube_proxy_pool_stats()}

    return {
        "status": "skipped",
        "action": action_key,
        "reason": "unsupported_action",
        "configured": bool(bootstrap.get("configured")),
        "pool": get_youtube_proxy_pool_stats(),
    }


def get_youtube_proxy_pool_stats() -> dict[str, Any]:
    entries = _youtube_proxy_pool_entries()
    client = _get_sync_redis()
    if client is None:
        return {
            "configured": bool(entries),
            "redis_available": False,
            "paused": False,
            "pool_size": len(entries),
            "active_proxy_count": 0,
            "burned_proxy_count": 0,
            "manually_paused_proxy_count": 0,
            "success_rate_pct": 0.0,
            "burn_rate_pct": 0.0,
            "estimated_cost_usd": 0.0,
            "proxies": [],
        }

    bootstrap = _ensure_youtube_proxy_pool_loaded()
    now = int(time.time())
    meta = client.hgetall(YOUTUBE_PROXY_POOL_META_KEY) or {}
    paused = str(meta.get("paused") or "0") == "1"
    cost_per_1000 = _youtube_proxy_cost_per_1000()

    proxies: list[dict[str, Any]] = []
    total_successes = 0
    total_failures = 0
    total_rejections = 0
    total_probes = 0
    active_proxy_count = 0
    burned_proxy_count = 0
    manually_paused_proxy_count = 0

    for proxy_url in entries:
        stats = client.hgetall(_youtube_proxy_stats_key(proxy_url)) or {}
        success_count = int(stats.get("success_count") or 0)
        failure_count = int(stats.get("failure_count") or 0)
        rejection_count = int(stats.get("rejection_count") or 0)
        total_probe_count = int(stats.get("total_probes") or (success_count + failure_count))
        burned_until = int(stats.get("burned_until") or 0)
        is_paused = str(stats.get("paused") or "0") == "1"
        is_burned = burned_until > now
        status = "paused" if paused or is_paused else "burned" if is_burned else "active"

        total_successes += success_count
        total_failures += failure_count
        total_rejections += rejection_count
        total_probes += total_probe_count
        if paused or is_paused:
            manually_paused_proxy_count += 1
        elif is_burned:
            burned_proxy_count += 1
        else:
            active_proxy_count += 1

        success_rate_pct = round((success_count / total_probe_count) * 100, 2) if total_probe_count else 0.0
        burn_rate_pct = round((rejection_count / total_probe_count) * 100, 2) if total_probe_count else 0.0
        proxies.append(
            {
                "proxy_id": stats.get("proxy_id") or _youtube_proxy_id(proxy_url),
                "endpoint_hint": stats.get("endpoint_hint") or _youtube_proxy_endpoint_hint(proxy_url),
                "status": status,
                "paused": paused or is_paused,
                "burned_until": burned_until or None,
                "burn_remaining_seconds": max(0, burned_until - now) if burned_until else 0,
                "success_count": success_count,
                "failure_count": failure_count,
                "rejection_count": rejection_count,
                "burn_events": int(stats.get("burn_events") or 0),
                "total_probes": total_probe_count,
                "success_rate_pct": success_rate_pct,
                "burn_rate_pct": burn_rate_pct,
                "estimated_cost_usd": round(total_probe_count * (cost_per_1000 / 1000 if cost_per_1000 else 0.0), 4),
                "last_allocated_at": int(stats.get("last_allocated_at") or 0) or None,
                "last_success_at": int(stats.get("last_success_at") or 0) or None,
                "last_failure_at": int(stats.get("last_failure_at") or 0) or None,
                "last_error": stats.get("last_error") or None,
                "last_state": stats.get("last_state") or "ready",
            }
        )

    success_rate_pct = round((total_successes / total_probes) * 100, 2) if total_probes else 0.0
    burn_rate_pct = round((total_rejections / total_probes) * 100, 2) if total_probes else 0.0
    estimated_cost_usd = round(total_probes * (cost_per_1000 / 1000 if cost_per_1000 else 0.0), 4)

    return {
        "configured": bool(bootstrap.get("configured")),
        "redis_available": bool(bootstrap.get("redis_available", True)),
        "paused": paused,
        "pool_size": len(entries),
        "active_proxy_count": active_proxy_count,
        "burned_proxy_count": burned_proxy_count,
        "manually_paused_proxy_count": manually_paused_proxy_count,
        "available_proxy_count": active_proxy_count,
        "total_successes": total_successes,
        "total_failures": total_failures,
        "total_rejections": total_rejections,
        "total_probes": total_probes,
        "success_rate_pct": success_rate_pct,
        "burn_rate_pct": burn_rate_pct,
        "estimated_cost_usd": estimated_cost_usd,
        "cost_per_1000_probes": cost_per_1000,
        "last_rotation_at": int(meta.get("last_rotation_at") or 0) or None,
        "last_allocated_proxy_id": meta.get("last_allocated_proxy_id") or None,
        "last_operator_action": meta.get("last_operator_action") or None,
        "proxies": proxies,
    }


def _load_state() -> dict[str, Any]:
    client = _get_sync_redis()
    if client is None:
        # HARD FAIL-SAFE: If Redis is dead, proxies are globally paused to prevent split-brain bans.
        return {"manually_paused": True, "redis_down": True}
        
    try:
        raw = client.get("nexus:proxy:telemetry")
        if not raw:
            return {} # Clean state
        return json.loads(raw)
    except Exception:
        # If Redis connection fails during read, fail-safe.
        return {"manually_paused": True, "redis_down": True}


def _save_state(state: dict[str, Any]) -> None:
    client = _get_sync_redis()
    if client is None:
        # Do not save to local memory. Let the system fail gracefully.
        print("CRITICAL: Redis unavailable. Dropping proxy state update to prevent split-brain.")
        return
        
    try:
        # Merge with existing state so we don't overwrite other workers' data
        existing_raw = client.get("nexus:proxy:telemetry")
        current_state = json.loads(existing_raw) if existing_raw else {}
        
        # We drop the temporary 'redis_down' flag before saving
        state.pop("redis_down", None) 
        
        merged_state = {**current_state, **state}
        client.set("nexus:proxy:telemetry", json.dumps(merged_state))
    except Exception as e:
        print(f"CRITICAL: Failed to write proxy state to Redis: {e}")


def _manual_paused_provider_set(state: dict[str, Any]) -> set[str]:
    current = state.get("manual_paused_providers")
    if current is None:
        current = state.get("paused_providers") or []
    return {str(item).strip().lower() for item in current if str(item).strip()}


def _auto_paused_provider_map(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = state.get("auto_paused_providers") or {}
    if not isinstance(raw, dict):
        return {}
    normalized: dict[str, dict[str, Any]] = {}
    for provider, payload in raw.items():
        provider_key = str(provider).strip().lower()
        if not provider_key:
            continue
        normalized[provider_key] = dict(payload or {})
    return normalized


def _write_provider_pause_state(state: dict[str, Any], manual_set: set[str], auto_map: dict[str, dict[str, Any]]) -> None:
    state["manual_paused_providers"] = sorted(manual_set)
    state["auto_paused_providers"] = auto_map
    state["paused_providers"] = sorted(set(manual_set) | set(auto_map.keys()))


def _persist_proxy_history(event_type: str, *, provider: str | None = None, reason: str | None = None, payload: dict[str, Any] | None = None) -> None:
    supabase = _get_supabase()
    if supabase is None:
        return
    try:
        supabase.table("proxy_burn_events").insert(
            {
                "event_type": event_type,
                "provider": str(provider or "unknown").lower(),
                "reason": reason,
                "payload": payload or {},
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        ).execute()
    except Exception:
        return


def _persist_owner_audit_event(action: str, *, target_type: str, target_id: str | None, detail: str | None = None, payload: dict[str, Any] | None = None) -> None:
    supabase = _get_supabase()
    if supabase is None:
        return
    audit_payload = {
        "actor_user_id": None,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "detail": detail,
        "payload": payload or {},
    }
    try:
        supabase.table("audit_logs").insert(audit_payload).execute()
    except Exception:
        try:
            supabase.table("abuse_events").insert(
                {
                    "user_id": None,
                    "event_type": f"owner_audit:{action}",
                    "detail": detail,
                    "payload": audit_payload,
                }
            ).execute()
        except Exception:
            return


def _increment_pending_rollup_counter(state: dict[str, Any], provider: str, field: str, amount: int = 1) -> None:
    pending = dict(state.get("pending_daily_rollups") or {})
    provider_key = str(provider or "unknown").lower()
    provider_bucket = dict(pending.get(provider_key) or {})
    provider_bucket[field] = int(provider_bucket.get(field) or 0) + int(amount)
    pending[provider_key] = provider_bucket
    state["pending_daily_rollups"] = pending


def _live_provider_counter_map(state: dict[str, Any]) -> dict[str, dict[str, int]]:
    raw = state.get("live_provider_counters") or {}
    if not isinstance(raw, dict):
        return {}
    normalized: dict[str, dict[str, int]] = {}
    for provider, payload in raw.items():
        provider_key = str(provider).strip().lower()
        if not provider_key:
            continue
        bucket = dict(payload or {})
        normalized[provider_key] = {
            "total_probes": int(bucket.get("total_probes") or 0),
            "successful_probes": int(bucket.get("successful_probes") or 0),
            "failed_probes": int(bucket.get("failed_probes") or 0),
            "burn_events": int(bucket.get("burn_events") or 0),
        }
    return normalized


def _write_live_provider_counter_map(state: dict[str, Any], counters: dict[str, dict[str, int]]) -> None:
    state["live_provider_counters"] = counters


def _increment_live_provider_counter(state: dict[str, Any], provider: str, field: str, amount: int = 1) -> None:
    counters = _live_provider_counter_map(state)
    provider_key = str(provider or "unknown").lower()
    bucket = dict(counters.get(provider_key) or {})
    bucket[field] = int(bucket.get(field) or 0) + int(amount)
    counters[provider_key] = bucket
    _write_live_provider_counter_map(state, counters)


def _reset_live_provider_counter(state: dict[str, Any], provider: str) -> None:
    counters = _live_provider_counter_map(state)
    provider_key = str(provider or "unknown").lower()
    counters.pop(provider_key, None)
    _write_live_provider_counter_map(state, counters)


def _build_live_provider_stats_from_counters(counters: dict[str, dict[str, int]]) -> dict[str, dict[str, Any]]:
    stats: dict[str, dict[str, Any]] = {}
    for provider_key, payload in counters.items():
        total_probes = int(payload.get("total_probes") or 0)
        successful_probes = int(payload.get("successful_probes") or 0)
        failed_probes = int(payload.get("failed_probes") or 0)
        burn_events = int(payload.get("burn_events") or 0)
        success_rate = round((successful_probes / total_probes) * 100, 2) if total_probes else 0.0
        burn_rate_per_1k = round((burn_events / total_probes) * 1000, 2) if total_probes else 0.0
        stats[provider_key] = {
            "provider_name": provider_key,
            "total_probes": total_probes,
            "successful_probes": successful_probes,
            "failed_probes": failed_probes,
            "burn_events": burn_events,
            "success_rate_pct": success_rate,
            "burn_rate_per_1k": burn_rate_per_1k,
        }
    return stats


def _persist_proxy_alert_history(
    *,
    alert_type: str,
    provider_name: str,
    total_probes: int,
    success_rate_pct: float,
    burn_rate_per_1k: float,
    reason_text: str,
) -> None:
    supabase = _get_supabase()
    if supabase is None:
        return
    try:
        supabase.table("proxy_alert_history").insert(
            {
                "alert_type": alert_type,
                "provider_name": str(provider_name or "unknown").lower(),
                "total_probes": int(total_probes),
                "success_rate_pct": round(float(success_rate_pct), 2),
                "burn_rate_per_1k": round(float(burn_rate_per_1k), 2),
                "reason_text": reason_text,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        ).execute()
    except Exception:
        return


def _recent_breaker_trip_count(provider_name: str) -> int:
    supabase = _get_supabase()
    if supabase is None:
        return 0

    provider_key = str(provider_name or "unknown").lower()
    since = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ",
        time.gmtime(time.time() - (_breaker_escalation_window_hours() * 3600)),
    )
    try:
        result = (
            supabase.table("proxy_alert_history")
            .select("id", count="exact")
            .eq("alert_type", "CIRCUIT_BREAKER_TRIPPED")
            .eq("provider_name", provider_key)
            .gte("created_at", since)
            .execute()
        )
        return int(getattr(result, "count", 0) or 0)
    except Exception:
        return 0


def _breaker_backoff_profile(provider_name: str) -> dict[str, Any]:
    recent_trips = _recent_breaker_trip_count(provider_name)
    total_trips = recent_trips + 1
    multiplier = 1
    escalation_level = "normal"
    hard_quarantine = total_trips >= _breaker_hard_quarantine_min_trips()
    if total_trips >= 4:
        multiplier = 4
        escalation_level = "severe"
    elif total_trips >= 2:
        multiplier = 2
        escalation_level = "elevated"

    if hard_quarantine:
        cooldown_seconds = _breaker_hard_quarantine_seconds()
        escalation_level = "quarantined"
    else:
        cooldown_seconds = min(
            _recovery_probe_interval_seconds() * multiplier,
            _breaker_escalation_max_cooldown_seconds(),
        )
    return {
        "recent_trips_in_window": recent_trips,
        "trip_count_with_current": total_trips,
        "cooldown_multiplier": multiplier,
        "cooldown_seconds": cooldown_seconds,
        "escalation_level": escalation_level,
        "window_hours": _breaker_escalation_window_hours(),
        "hard_quarantine": hard_quarantine,
    }


def _entry_recovery_cooldown_seconds(entry: dict[str, Any] | None) -> int:
    if not entry:
        return _recovery_probe_interval_seconds()
    return max(
        _recovery_probe_interval_seconds(),
        int(entry.get("recovery_cooldown_seconds") or _recovery_probe_interval_seconds()),
    )


def auto_pause_provider(
    provider: str,
    *,
    reason: str,
    paused_by: str,
    trigger_metrics: dict[str, Any] | None = None,
) -> None:
    state = _load_state()
    if state.get("redis_down"):
        return

    now = int(time.time())
    provider_key = str(provider or "unknown").lower()
    manual_paused = _manual_paused_provider_set(state)
    auto_paused = _auto_paused_provider_map(state)
    if provider_key in manual_paused:
        return

    existing = dict(auto_paused.get(provider_key) or {})
    backoff_profile = _breaker_backoff_profile(provider_key) if paused_by == "circuit_breaker_tripped" else {
        "recent_trips_in_window": 0,
        "trip_count_with_current": 0,
        "cooldown_multiplier": 1,
        "cooldown_seconds": _recovery_probe_interval_seconds(),
        "escalation_level": "normal",
        "window_hours": _breaker_escalation_window_hours(),
    }
    cooldown_seconds = int(backoff_profile.get("cooldown_seconds") or _recovery_probe_interval_seconds())
    auto_paused[provider_key] = {
        **existing,
        "paused_at": now,
        "next_health_check_at": now + cooldown_seconds,
        "last_reason": reason,
        "recovery_status": "quarantined" if backoff_profile.get("hard_quarantine") else "paused",
        "half_open_allowance_remaining": 0,
        "health_probe_budget": _half_open_probe_budget(),
        "health_probe_successes": 0,
        "health_probe_failures": 0,
        "recovery_window_started_at": None,
        "recovery_window_expires_at": None,
        "paused_by": paused_by,
        "trigger_metrics": trigger_metrics or {},
        "recovery_cooldown_seconds": cooldown_seconds,
        "cooldown_multiplier": int(backoff_profile.get("cooldown_multiplier") or 1),
        "escalation_level": backoff_profile.get("escalation_level") or "normal",
        "hard_quarantine": bool(backoff_profile.get("hard_quarantine")),
        "quarantine_until": (now + cooldown_seconds) if backoff_profile.get("hard_quarantine") else None,
        "recent_breaker_trips_in_window": int(backoff_profile.get("recent_trips_in_window") or 0),
        "trip_count_with_current": int(backoff_profile.get("trip_count_with_current") or 0),
        "trip_window_hours": int(backoff_profile.get("window_hours") or _breaker_escalation_window_hours()),
    }
    _write_provider_pause_state(state, manual_paused, auto_paused)
    state["last_operator_action"] = f"{paused_by}:{provider_key}"
    _save_state(state)
    _persist_proxy_history(
        paused_by,
        provider=provider_key,
        reason=reason,
        payload={
            "next_health_check_at": auto_paused[provider_key]["next_health_check_at"],
            "trigger_metrics": trigger_metrics or {},
            "cooldown_seconds": cooldown_seconds,
            "cooldown_multiplier": auto_paused[provider_key]["cooldown_multiplier"],
            "escalation_level": auto_paused[provider_key]["escalation_level"],
            "hard_quarantine": auto_paused[provider_key]["hard_quarantine"],
            "quarantine_until": auto_paused[provider_key]["quarantine_until"],
        },
    )
    _persist_owner_audit_event(
        paused_by,
        target_type="proxy_provider",
        target_id=provider_key,
        detail=reason,
        payload={
            "next_health_check_at": auto_paused[provider_key]["next_health_check_at"],
            "trigger_metrics": trigger_metrics or {},
            "cooldown_seconds": cooldown_seconds,
            "cooldown_multiplier": auto_paused[provider_key]["cooldown_multiplier"],
            "escalation_level": auto_paused[provider_key]["escalation_level"],
            "hard_quarantine": auto_paused[provider_key]["hard_quarantine"],
            "quarantine_until": auto_paused[provider_key]["quarantine_until"],
        },
    )


def get_metadata_proxy_url(provider: str | None = None) -> str | None:
    state = _load_state()

    if state.get("manually_paused") or state.get("redis_down"):
        return None

    provider_key = str(provider or "unknown").lower()
    manual_paused = _manual_paused_provider_set(state)
    auto_paused = _auto_paused_provider_map(state)
    now = int(time.time())
    burned_until = int(state.get("burned_until") or 0) if state.get("burned_until") else None

    if provider_key in manual_paused:
        return None

    # Per user instruction: Only YouTube requires proxy routing; all other platforms run directly.
    if provider_key != "youtube":
        return None

    if provider_key in auto_paused:
        entry = dict(auto_paused.get(provider_key) or {})
        proxy_url = _proxy_endpoint()
        if not proxy_url:
            return None
        next_health_check_at = int(entry.get("next_health_check_at") or 0)
        allowance_remaining = int(entry.get("half_open_allowance_remaining") or 0)
        recovery_window_expires_at = int(entry.get("recovery_window_expires_at") or 0)

        if recovery_window_expires_at and recovery_window_expires_at <= now:
            entry["half_open_allowance_remaining"] = 0
            entry["health_probe_successes"] = 0
            entry["health_probe_failures"] = 0
            entry["recovery_status"] = "quarantined" if entry.get("hard_quarantine") else "paused"
            entry["recovery_window_expires_at"] = None
            entry["recovery_window_started_at"] = None
            entry["next_health_check_at"] = now + _entry_recovery_cooldown_seconds(entry)
            auto_paused[provider_key] = entry
            _write_provider_pause_state(state, manual_paused, auto_paused)
            _save_state(state)
            return None

        if allowance_remaining > 0 and (not recovery_window_expires_at or recovery_window_expires_at > now):
            entry["half_open_allowance_remaining"] = allowance_remaining - 1
            entry["recovery_status"] = "half_open"
            auto_paused[provider_key] = entry
            _write_provider_pause_state(state, manual_paused, auto_paused)
            _save_state(state)
            return proxy_url

        if next_health_check_at and next_health_check_at > now:
            return None

        return None

    if burned_until and burned_until > now:
        return None

    return _proxy_endpoint()


def record_proxy_probe(*, success: bool, via_proxy: bool, provider: str | None = None, reason: str | None = None) -> None:
    state = _load_state()
    if state.get("redis_down"):
        return # Prevent desynced workers from logging into the void

    state["total_probes"] = int(state.get("total_probes") or 0) + 1
    if via_proxy:
        state["proxied_probes"] = int(state.get("proxied_probes") or 0) + 1
    if success:
        state["successes"] = int(state.get("successes") or 0) + 1
    else:
        state["failures"] = int(state.get("failures") or 0) + 1
    if reason:
        state["last_failure_reason"] = reason
        
    provider_key = str(provider or "unknown").lower()
    provider_counts = dict(state.get("provider_counts") or {})
    provider_counts[provider_key] = int(provider_counts.get(provider_key) or 0) + 1
    state["provider_counts"] = provider_counts
    _increment_pending_rollup_counter(state, provider_key, "total_probes", 1)
    if success:
        _increment_pending_rollup_counter(state, provider_key, "successful_probes", 1)
    else:
        _increment_pending_rollup_counter(state, provider_key, "failed_probes", 1)
    if via_proxy:
        _increment_pending_rollup_counter(state, provider_key, "proxied_probes", 1)
        _increment_live_provider_counter(state, provider_key, "total_probes", 1)
        if success:
            _increment_live_provider_counter(state, provider_key, "successful_probes", 1)
        else:
            _increment_live_provider_counter(state, provider_key, "failed_probes", 1)

    manual_paused = _manual_paused_provider_set(state)
    auto_paused = _auto_paused_provider_map(state)
    if via_proxy and provider_key in auto_paused:
        entry = dict(auto_paused.get(provider_key) or {})
        entry["health_probe_successes"] = int(entry.get("health_probe_successes") or 0) + (1 if success else 0)
        entry["health_probe_failures"] = int(entry.get("health_probe_failures") or 0) + (0 if success else 1)
        attempts = int(entry.get("health_probe_successes") or 0) + int(entry.get("health_probe_failures") or 0)
        budget = int(entry.get("health_probe_budget") or _half_open_probe_budget())
        if attempts >= budget:
            success_rate = (int(entry.get("health_probe_successes") or 0) / attempts) * 100 if attempts else 0
            if success_rate > 80:
                auto_paused.pop(provider_key, None)
                _write_provider_pause_state(state, manual_paused, auto_paused)
                state["last_operator_action"] = f"auto_resume_provider_proxy:{provider_key}"
                _save_state(state)
                _persist_proxy_history(
                    "auto_resume_health_restored",
                    provider=provider_key,
                    reason="health_check_passed",
                    payload={"success_rate_pct": round(success_rate, 2), "attempts": attempts},
                )
                _persist_owner_audit_event(
                    "auto_resume_health_restored",
                    target_type="proxy_provider",
                    target_id=provider_key,
                    detail="Provider auto-resumed after half-open recovery probes.",
                    payload={"success_rate_pct": round(success_rate, 2), "attempts": attempts},
                )
                return

            entry["half_open_allowance_remaining"] = 0
            entry["health_probe_successes"] = 0
            entry["health_probe_failures"] = 0
            entry["recovery_status"] = "quarantined" if entry.get("hard_quarantine") else "paused"
            entry["recovery_window_started_at"] = None
            entry["recovery_window_expires_at"] = None
            entry["next_health_check_at"] = int(time.time()) + _entry_recovery_cooldown_seconds(entry)
            auto_paused[provider_key] = entry
            _write_provider_pause_state(state, manual_paused, auto_paused)
            state["last_operator_action"] = f"auto_recovery_failed:{provider_key}"
            _save_state(state)
            _persist_proxy_history(
                "auto_recovery_failed",
                provider=provider_key,
                reason=reason or "health_check_failed",
                payload={
                    "attempts": attempts,
                    "success_rate_pct": round(success_rate, 2),
                    "next_health_check_at": entry["next_health_check_at"],
                    "cooldown_seconds": _entry_recovery_cooldown_seconds(entry),
                    "escalation_level": entry.get("escalation_level"),
                },
            )
            _persist_owner_audit_event(
                "auto_recovery_failed",
                target_type="proxy_provider",
                target_id=provider_key,
                detail="Provider remained auto-paused after half-open recovery probes.",
                payload={
                    "attempts": attempts,
                    "success_rate_pct": round(success_rate, 2),
                    "next_health_check_at": entry["next_health_check_at"],
                    "cooldown_seconds": _entry_recovery_cooldown_seconds(entry),
                    "escalation_level": entry.get("escalation_level"),
                },
            )
            return

        auto_paused[provider_key] = entry
        _write_provider_pause_state(state, manual_paused, auto_paused)

    _save_state(state)


def mark_proxy_burned(reason: str, *, provider: str | None = None) -> None:
    state = _load_state()
    if state.get("redis_down"):
        return 
        
    now = int(time.time())
    state["burn_events"] = int(state.get("burn_events") or 0) + 1
    state["last_burn_at"] = now
    state["last_burn_reason"] = reason
    state["last_operator_action"] = "auto_burn"
    provider_key = str(provider or "unknown").lower()
    _increment_pending_rollup_counter(state, provider_key, "burn_events", 1)
    _increment_live_provider_counter(state, provider_key, "burn_events", 1)
    manual_paused = _manual_paused_provider_set(state)

    if provider_key and provider_key not in manual_paused:
        _save_state(state)
        auto_pause_provider(provider_key, reason=reason, paused_by="auto_pause_provider_proxy")
    else:
        burned_until = now + _burn_ttl_seconds()
        state["burned_until"] = burned_until
        _save_state(state)
        _persist_proxy_history(
            "burn",
            provider=provider,
            reason=reason,
            payload={
                "burned_until": state.get("burned_until"),
                "next_health_check_at": None,
            },
        )


def probe_paused_providers() -> dict[str, Any]:
    state = _load_state()
    if state.get("redis_down"):
        return {"status": "skipped", "reason": "redis_failsafe_active", "eligible_providers": 0, "opened_providers": 0}
    if state.get("manually_paused") or not _proxy_endpoint():
        return {"status": "skipped", "reason": "proxy_globally_unavailable", "eligible_providers": 0, "opened_providers": 0}

    now = int(time.time())
    manual_paused = _manual_paused_provider_set(state)
    auto_paused = _auto_paused_provider_map(state)
    eligible = 0
    opened = 0

    for provider_key, entry in list(auto_paused.items()):
        if provider_key in manual_paused:
            continue
        next_health_check_at = int(entry.get("next_health_check_at") or 0)
        allowance_remaining = int(entry.get("half_open_allowance_remaining") or 0)
        recovery_window_expires_at = int(entry.get("recovery_window_expires_at") or 0)

        if recovery_window_expires_at and recovery_window_expires_at <= now:
            entry["half_open_allowance_remaining"] = 0
            entry["health_probe_successes"] = 0
            entry["health_probe_failures"] = 0
            entry["recovery_status"] = "quarantined" if entry.get("hard_quarantine") else "paused"
            entry["recovery_window_started_at"] = None
            entry["recovery_window_expires_at"] = None
            entry["next_health_check_at"] = now + _entry_recovery_cooldown_seconds(entry)
            auto_paused[provider_key] = entry
            _persist_proxy_history(
                "auto_recovery_window_expired",
                provider=provider_key,
                reason=entry.get("last_reason"),
                payload={
                    "next_health_check_at": entry["next_health_check_at"],
                    "cooldown_seconds": _entry_recovery_cooldown_seconds(entry),
                    "escalation_level": entry.get("escalation_level"),
                },
            )
            continue

        if allowance_remaining > 0:
            continue
        if next_health_check_at and next_health_check_at > now:
            continue
        eligible += 1
        entry["hard_quarantine"] = False
        if str(entry.get("escalation_level") or "").lower() == "quarantined":
            entry["escalation_level"] = "severe"
        entry["quarantine_until"] = None
        entry["half_open_allowance_remaining"] = _half_open_probe_budget()
        entry["health_probe_budget"] = _half_open_probe_budget()
        entry["health_probe_successes"] = 0
        entry["health_probe_failures"] = 0
        entry["recovery_status"] = "half_open"
        entry["recovery_window_started_at"] = now
        entry["recovery_window_expires_at"] = now + _recovery_probe_interval_seconds()
        entry["last_probe_release_at"] = now
        auto_paused[provider_key] = entry
        opened += 1
        _persist_proxy_history(
            "auto_recovery_probe_opened",
            provider=provider_key,
            reason=entry.get("last_reason"),
            payload={"probe_budget": _half_open_probe_budget(), "recovery_window_expires_at": entry["recovery_window_expires_at"]},
        )

    _write_provider_pause_state(state, manual_paused, auto_paused)
    if opened:
        state["last_operator_action"] = "auto_recovery_probe_opened"
    _save_state(state)
    return {"status": "ok", "reason": None, "eligible_providers": eligible, "opened_providers": opened}


def get_live_proxy_stats() -> dict[str, dict[str, Any]]:
    state = _load_state()
    if state.get("redis_down"):
        return {}
    return _build_live_provider_stats_from_counters(_live_provider_counter_map(state))


def enforce_circuit_breakers() -> dict[str, Any]:
    initial_state = _load_state()
    if initial_state.get("redis_down"):
        return {"status": "skipped", "reason": "redis_failsafe_active", "tripped": 0, "evaluated": 0}
    if initial_state.get("manually_paused") or not _proxy_endpoint():
        return {"status": "skipped", "reason": "proxy_globally_unavailable", "tripped": 0, "evaluated": 0}

    min_probes = _breaker_min_probes()
    min_success_rate_pct = _breaker_min_success_rate_pct()
    max_burn_rate_per_1k = _breaker_max_burn_rate_per_1k()
    manual_paused = _manual_paused_provider_set(initial_state)
    auto_paused = _auto_paused_provider_map(initial_state)
    live_counters = _live_provider_counter_map(initial_state)
    evaluated = 0
    tripped = 0

    for provider_key, stats in _build_live_provider_stats_from_counters(live_counters).items():
        if provider_key in manual_paused or provider_key in auto_paused:
            continue

        total_probes = int(stats.get("total_probes") or 0)
        if total_probes < min_probes:
            continue

        evaluated += 1
        success_rate_pct = float(stats.get("success_rate_pct") or 0.0)
        burn_rate_per_1k = float(stats.get("burn_rate_per_1k") or 0.0)

        trigger_reason: str | None = None
        if success_rate_pct < min_success_rate_pct:
            trigger_reason = (
                f"CIRCUIT BREAKER TRIPPED: Success rate {round(success_rate_pct, 2)}% "
                f"fell below {round(min_success_rate_pct, 2)}% after {total_probes} live proxied probes"
            )
        elif burn_rate_per_1k > max_burn_rate_per_1k:
            trigger_reason = (
                f"CIRCUIT BREAKER TRIPPED: Burn rate hit {round(burn_rate_per_1k, 2)}/1k "
                f"above {round(max_burn_rate_per_1k, 2)}/1k after {total_probes} live proxied probes"
            )

        if not trigger_reason:
            continue

        trigger_metrics = {
            "total_probes": total_probes,
            "successful_probes": int(stats.get("successful_probes") or 0),
            "failed_probes": int(stats.get("failed_probes") or 0),
            "burn_events": int(stats.get("burn_events") or 0),
            "success_rate_pct": round(success_rate_pct, 2),
            "burn_rate_per_1k": round(burn_rate_per_1k, 2),
            "threshold_min_success_rate_pct": round(min_success_rate_pct, 2),
            "threshold_max_burn_rate_per_1k": round(max_burn_rate_per_1k, 2),
            "threshold_min_probes": min_probes,
        }
        auto_pause_provider(
            provider_key,
            reason=trigger_reason,
            paused_by="circuit_breaker_tripped",
            trigger_metrics=trigger_metrics,
        )
        _persist_proxy_alert_history(
            alert_type="CIRCUIT_BREAKER_TRIPPED",
            provider_name=provider_key,
            total_probes=total_probes,
            success_rate_pct=success_rate_pct,
            burn_rate_per_1k=burn_rate_per_1k,
            reason_text=trigger_reason,
        )
        state_after_pause = _load_state()
        if not state_after_pause.get("redis_down"):
            _reset_live_provider_counter(state_after_pause, provider_key)
            _save_state(state_after_pause)
        tripped += 1

    return {"status": "ok", "reason": None, "tripped": tripped, "evaluated": evaluated}


def clear_proxy_burn() -> dict[str, Any]:
    state = _load_state()
    if not state.get("redis_down"):
        state["burned_until"] = None
        state["last_operator_action"] = "clear_burn"
        _save_state(state)
        _persist_proxy_history("clear_burn", reason="owner_clear_burn")
        
    return get_proxy_telemetry()


def set_proxy_paused(paused: bool) -> dict[str, Any]:
    state = _load_state()
    if not state.get("redis_down"):
        state["manually_paused"] = bool(paused)
        state["last_operator_action"] = "pause_proxy" if paused else "resume_proxy"
        _save_state(state)
        _persist_proxy_history("pause_proxy" if paused else "resume_proxy", reason="owner_proxy_control")
        
    return get_proxy_telemetry()


def set_provider_proxy_paused(provider: str, paused: bool) -> dict[str, Any]:
    state = _load_state()
    if not state.get("redis_down"):
        provider_key = str(provider or "unknown").strip().lower()
        manual_paused = _manual_paused_provider_set(state)
        auto_paused = _auto_paused_provider_map(state)
        if paused:
            manual_paused.add(provider_key)
        else:
            manual_paused.discard(provider_key)
        _write_provider_pause_state(state, manual_paused, auto_paused)
        state["last_operator_action"] = f"{'pause' if paused else 'resume'}_provider_proxy:{provider_key}"
        _save_state(state)
        _persist_proxy_history(
            "pause_provider_proxy" if paused else "resume_provider_proxy",
            provider=provider_key,
            reason="owner_provider_proxy_control",
        )
        
    return get_proxy_telemetry()


def set_provider_proxy_quarantined(provider: str, quarantined: bool, *, reason: str | None = None) -> dict[str, Any]:
    state = _load_state()
    if not state.get("redis_down"):
        provider_key = str(provider or "unknown").strip().lower()
        manual_paused = _manual_paused_provider_set(state)
        auto_paused = _auto_paused_provider_map(state)
        now = int(time.time())
        if quarantined:
            existing = dict(auto_paused.get(provider_key) or {})
            cooldown_seconds = _breaker_hard_quarantine_seconds()
            auto_paused[provider_key] = {
                **existing,
                "paused_at": now,
                "next_health_check_at": now + cooldown_seconds,
                "last_reason": reason or "Owner forced provider quarantine.",
                "recovery_status": "quarantined",
                "half_open_allowance_remaining": 0,
                "health_probe_budget": _half_open_probe_budget(),
                "health_probe_successes": 0,
                "health_probe_failures": 0,
                "recovery_window_started_at": None,
                "recovery_window_expires_at": None,
                "paused_by": "owner_force_quarantine",
                "trigger_metrics": {},
                "recovery_cooldown_seconds": cooldown_seconds,
                "cooldown_multiplier": max(1, int(cooldown_seconds / max(_recovery_probe_interval_seconds(), 1))),
                "escalation_level": "quarantined",
                "hard_quarantine": True,
                "quarantine_until": now + cooldown_seconds,
                "recent_breaker_trips_in_window": int(existing.get("recent_breaker_trips_in_window") or 0),
                "trip_count_with_current": int(existing.get("trip_count_with_current") or 0),
                "trip_window_hours": int(existing.get("trip_window_hours") or _breaker_escalation_window_hours()),
            }
            _write_provider_pause_state(state, manual_paused, auto_paused)
            _reset_live_provider_counter(state, provider_key)
            state["last_operator_action"] = f"force_quarantine_provider_proxy:{provider_key}"
            _save_state(state)
            _persist_proxy_history(
                "force_quarantine_provider_proxy",
                provider=provider_key,
                reason=reason or "owner_force_quarantine",
                payload={"quarantine_until": auto_paused[provider_key]["quarantine_until"]},
            )
        else:
            if provider_key in auto_paused:
                auto_paused.pop(provider_key, None)
                _write_provider_pause_state(state, manual_paused, auto_paused)
                _reset_live_provider_counter(state, provider_key)
                state["last_operator_action"] = f"release_quarantine_provider_proxy:{provider_key}"
                _save_state(state)
                _persist_proxy_history(
                    "release_quarantine_provider_proxy",
                    provider=provider_key,
                    reason=reason or "owner_release_quarantine",
                    payload={"manual_pause_still_active": provider_key in manual_paused},
                )

    return get_proxy_telemetry()


def get_proxy_telemetry() -> dict[str, Any]:
    state = _load_state()
    now = int(time.time())
    burned_until = int(state.get("burned_until") or 0) if state.get("burned_until") else None
    redis_down = bool(state.get("redis_down"))
    manual_paused = sorted(_manual_paused_provider_set(state))
    auto_paused = _auto_paused_provider_map(state)
    live_provider_stats = _build_live_provider_stats_from_counters(_live_provider_counter_map(state)) if not redis_down else {}
    youtube_pool = get_youtube_proxy_pool_stats()
    auto_paused_states: dict[str, Any] = {}
    for provider_key, entry in auto_paused.items():
        next_health_check_at = int(entry.get("next_health_check_at") or 0)
        recovery_window_expires_at = int(entry.get("recovery_window_expires_at") or 0)
        auto_paused_states[provider_key] = {
            **entry,
            "next_health_check_in_seconds": max(0, next_health_check_at - now) if next_health_check_at else 0,
            "recovery_window_remaining_seconds": max(0, recovery_window_expires_at - now) if recovery_window_expires_at else 0,
            "manually_blocked": provider_key in manual_paused,
            "live_stats": live_provider_stats.get(provider_key) or None,
        }

    return {
        "configured": bool(_proxy_endpoint()),
        "mode": "residential_metadata_only" if _proxy_endpoint() else "direct",
        "endpoint_hint": _masked_proxy(_proxy_endpoint()),
        "youtube_pool": youtube_pool,
        "total_probes": int(state.get("total_probes") or 0),
        "proxied_probes": int(state.get("proxied_probes") or 0),
        "successes": int(state.get("successes") or 0),
        "failures": int(state.get("failures") or 0),
        "burn_events": int(state.get("burn_events") or 0),
        "last_burn_at": state.get("last_burn_at"),
        "last_burn_reason": state.get("last_burn_reason"),
        "last_failure_reason": state.get("last_failure_reason"),
        "burned_until": burned_until,
        "burn_active": bool(burned_until and burned_until > now),
        "burn_ttl_seconds": _burn_ttl_seconds(),
        "provider_counts": state.get("provider_counts") or {},
        "manually_paused": bool(state.get("manually_paused")),
        "paused_providers": sorted(set(manual_paused) | set(auto_paused.keys())),
        "manual_paused_providers": manual_paused,
        "auto_paused_providers": sorted(auto_paused.keys()),
        "auto_paused_provider_states": auto_paused_states,
        "live_provider_stats": live_provider_stats,
        "auto_recovery_interval_seconds": _recovery_probe_interval_seconds(),
        "half_open_probe_budget": _half_open_probe_budget(),
        "breaker_thresholds": {
            "min_probes": _breaker_min_probes(),
            "min_success_rate_pct": _breaker_min_success_rate_pct(),
            "max_burn_rate_per_1k": _breaker_max_burn_rate_per_1k(),
        },
        "breaker_escalation": {
            "window_hours": _breaker_escalation_window_hours(),
            "max_cooldown_seconds": _breaker_escalation_max_cooldown_seconds(),
            "hard_quarantine_min_trips": _breaker_hard_quarantine_min_trips(),
            "hard_quarantine_seconds": _breaker_hard_quarantine_seconds(),
        },
        "last_operator_action": state.get("last_operator_action"),
        "effective_proxy_enabled": (
            (bool(_proxy_endpoint()) or bool(youtube_pool.get("configured")))
            and not bool(state.get("manually_paused"))
            and not bool(burned_until and burned_until > now)
            and not redis_down
        ),
        "redis_down_failsafe_active": redis_down
    }


def flush_proxy_daily_rollups_now() -> dict[str, Any]:
    client = _get_sync_redis()
    supabase = _get_supabase()
    if client is None:
        return {"status": "skipped", "persisted": False, "reason": "redis_unavailable", "source_rows": 0, "rollup_rows": 0}
    if supabase is None:
        return {"status": "skipped", "persisted": False, "reason": "supabase_unavailable", "source_rows": 0, "rollup_rows": 0}

    state = _load_state()
    if state.get("redis_down"):
        return {"status": "skipped", "persisted": False, "reason": "redis_failsafe_active", "source_rows": 0, "rollup_rows": 0}

    pending = dict(state.get("pending_daily_rollups") or {})
    if not pending:
        return {"status": "ok", "persisted": True, "reason": None, "source_rows": 0, "rollup_rows": 0}

    provider_costs = _proxy_provider_costs()
    default_cost_per_1000 = float(os.environ.get("PROXY_COST_PER_1000_PROBES", "0") or 0)
    rollup_date = time.strftime("%Y-%m-%d", time.gmtime())
    processed = 0

    try:
        for provider_name, counters in pending.items():
            provider_key = str(provider_name or "unknown").lower()
            total_probes = int(counters.get("total_probes") or 0)
            successful_probes = int(counters.get("successful_probes") or 0)
            failed_probes = int(counters.get("failed_probes") or 0)
            burn_events = int(counters.get("burn_events") or 0)
            proxied_probes = int(counters.get("proxied_probes") or 0)

            provider_cost = provider_costs.get(provider_key, default_cost_per_1000)
            estimated_cost_usd = round((proxied_probes * (provider_cost / 1000 if provider_cost else 0.0)), 4)

            existing = (
                supabase.table("proxy_daily_rollups")
                .select("*")
                .eq("rollup_date", rollup_date)
                .eq("provider_name", provider_key)
                .limit(1)
                .execute()
            )
            existing_row = (existing.data or [{}])[0] if getattr(existing, "data", None) else {}

            payload = {
                "id": existing_row.get("id"),
                "rollup_date": rollup_date,
                "provider_name": provider_key,
                "total_probes": int(existing_row.get("total_probes") or 0) + total_probes,
                "successful_probes": int(existing_row.get("successful_probes") or 0) + successful_probes,
                "failed_probes": int(existing_row.get("failed_probes") or 0) + failed_probes,
                "burn_events": int(existing_row.get("burn_events") or 0) + burn_events,
                "estimated_cost_usd": round(float(existing_row.get("estimated_cost_usd") or 0) + estimated_cost_usd, 4),
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            if not payload["id"]:
                payload.pop("id")

            supabase.table("proxy_daily_rollups").upsert(payload).execute()
            processed += 1

        state["pending_daily_rollups"] = {}
        _save_state(state)
        return {"status": "ok", "persisted": True, "reason": None, "source_rows": len(pending), "rollup_rows": processed}
    except Exception as exc:
        return {"status": "skipped", "persisted": False, "reason": str(exc), "source_rows": len(pending), "rollup_rows": processed}
