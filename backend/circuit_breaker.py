"""
NEXUS Phase 6 P1-1 — Distributed Circuit Breaker Synchronization
=================================================================

Atomic, multi-process distributed circuit breaker synchronized via Redis.
Protects the platform from cascading failures caused by upstream provider
outages (e.g. YouTube bot bans, Instagram rate limits, storage 5xx).

States:
-------
  CLOSED    -> Normal operation. All requests allowed.
  OPEN      -> Threshold breached. Requests immediately rejected/deferred (503 / Retry-After).
  HALF_OPEN -> Cooldown elapsed. Bounded probe requests permitted to verify recovery.

Atomicity:
----------
Redis Lua scripts guarantee atomic state checks and transitions across all
uvicorn workers and nodes with zero race conditions.

Cardinality Safety:
-------------------
Keys are strictly scoped to bounded providers (e.g. `nexus:circuit:upstream:youtube`).
No job IDs, user IDs, or URLs are ever stored in key paths.

Feature Flag:
-------------
Gated by `NEXUS_CIRCUIT_BREAKER_ENABLED` (default: false / 0).
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum
import logging
import os
import time
from typing import Any

log = logging.getLogger("nexus.circuit_breaker")


class CircuitState(str, Enum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


STATE_CLOSED = CircuitState.CLOSED
STATE_OPEN = CircuitState.OPEN
STATE_HALF_OPEN = CircuitState.HALF_OPEN


@dataclass(frozen=True)
class CircuitCheckResult:
    allowed: bool
    state: CircuitState
    retry_after: int = 0
    is_probe: bool = False
    reason: str = ""


from backend.api_v1.middleware import _get_redis_client


# ─── Configuration & Defaults ────────────────────────────────────────────────
def is_circuit_breaker_enabled() -> bool:
    return os.environ.get("NEXUS_CIRCUIT_BREAKER_ENABLED", "0").lower() in ("1", "true", "yes")

FAILURE_THRESHOLD = int(os.environ.get("NEXUS_CIRCUIT_FAILURE_THRESHOLD", "5"))
WINDOW_SECONDS = int(os.environ.get("NEXUS_CIRCUIT_WINDOW_SECONDS", "60"))
OPEN_DURATION_SECONDS = int(os.environ.get("NEXUS_CIRCUIT_OPEN_DURATION_SECONDS", "30"))
HALF_OPEN_PROBES = int(os.environ.get("NEXUS_CIRCUIT_HALF_OPEN_PROBES", "2"))
SUCCESS_THRESHOLD = int(os.environ.get("NEXUS_CIRCUIT_SUCCESS_THRESHOLD", "2"))

# Non-qualifying error codes that must NEVER trip a circuit breaker
NON_QUALIFYING_CODES = frozenset({
    "cancelled",
    "no_formats",
    "invalid_url",
    "ssrf_blocked",
    "outbound_policy_violation",
    "unauthorized",
    "insufficient_credits",
    "bad_request",
    "not_found",
    "file_too_large",
    "unsupported_codec",
})

# Qualifying error indicators for systemic dependency issues
QUALIFYING_CODES = frozenset({
    "download_timeout",
    "upstream_error",
    "upstream_5xx",
    "upstream_429",
    "connection_error",
    "network_error",
    "storage_error",
    "storage_outage",
})


def _sanitize_provider(provider: str | None) -> str:
    from backend.metrics import _sanitize, ALLOWED_PROVIDERS
    return _sanitize(provider, ALLOWED_PROVIDERS, "generic")


def _circuit_keys(provider: str, domain: str = "upstream") -> tuple[str, str, str, str, str]:
    prov = _sanitize_provider(provider)
    prefix = f"nexus:circuit:{domain}:{prov}"
    return (
        f"{prefix}:state",
        f"{prefix}:opened_at",
        f"{prefix}:failures",
        f"{prefix}:probes",
        f"{prefix}:successes",
    )


# ─── Redis Lua Atomic Scripts ────────────────────────────────────────────────

# Script 1: Atomic Check & Probe Allocation
LUA_CHECK_STATE = """
local state_key = KEYS[1]
local opened_at_key = KEYS[2]
local probes_key = KEYS[3]

local now = tonumber(ARGV[1])
local open_duration = tonumber(ARGV[2])
local max_probes = tonumber(ARGV[3])

local state = redis.call("GET", state_key) or "CLOSED"

if state == "CLOSED" then
    return {1, "CLOSED", 0, 0}
end

if state == "OPEN" then
    local opened_at = tonumber(redis.call("GET", opened_at_key) or "0")
    local elapsed = now - opened_at
    if elapsed >= open_duration then
        -- Transition to HALF_OPEN
        redis.call("SET", state_key, "HALF_OPEN")
        redis.call("SET", probes_key, "1")
        redis.call("EXPIRE", state_key, open_duration * 2)
        redis.call("EXPIRE", probes_key, open_duration * 2)
        return {1, "HALF_OPEN", 0, 1}
    else
        local retry_after = math.max(1, math.ceil(open_duration - elapsed))
        return {0, "OPEN", retry_after, 0}
    end
end

if state == "HALF_OPEN" then
    local probes = tonumber(redis.call("GET", probes_key) or "0")
    if probes < max_probes then
        redis.call("INCR", probes_key)
        return {1, "HALF_OPEN", 0, 1}
    else
        return {0, "HALF_OPEN", 10, 0}
    end
end

return {1, "CLOSED", 0, 0}
"""

# Script 2: Atomic Failure Recording
LUA_RECORD_FAILURE = """
local state_key = KEYS[1]
local opened_at_key = KEYS[2]
local failures_key = KEYS[3]
local probes_key = KEYS[4]
local successes_key = KEYS[5]

local now = tonumber(ARGV[1])
local failure_threshold = tonumber(ARGV[2])
local window_seconds = tonumber(ARGV[3])
local open_duration = tonumber(ARGV[4])

local state = redis.call("GET", state_key) or "CLOSED"

if state == "HALF_OPEN" then
    -- Probe failed: trip immediately back to OPEN
    redis.call("SET", state_key, "OPEN")
    redis.call("SET", opened_at_key, tostring(now))
    redis.call("DEL", probes_key)
    redis.call("DEL", successes_key)
    redis.call("EXPIRE", state_key, open_duration * 2)
    redis.call("EXPIRE", opened_at_key, open_duration * 2)
    return {1, "OPEN"}
end

if state == "CLOSED" then
    redis.call("ZADD", failures_key, now, tostring(now))
    redis.call("ZREMRANGEBYSCORE", failures_key, "-inf", now - window_seconds)
    redis.call("EXPIRE", failures_key, window_seconds + 30)
    local count = redis.call("ZCARD", failures_key)
    if count >= failure_threshold then
        redis.call("SET", state_key, "OPEN")
        redis.call("SET", opened_at_key, tostring(now))
        redis.call("EXPIRE", state_key, open_duration * 2)
        redis.call("EXPIRE", opened_at_key, open_duration * 2)
        return {1, "OPEN"}
    end
    return {0, "CLOSED"}
end

return {0, state}
"""

# Script 3: Atomic Success Recording
LUA_RECORD_SUCCESS = """
local state_key = KEYS[1]
local opened_at_key = KEYS[2]
local failures_key = KEYS[3]
local probes_key = KEYS[4]
local successes_key = KEYS[5]

local success_threshold = tonumber(ARGV[1])

local state = redis.call("GET", state_key) or "CLOSED"

if state == "HALF_OPEN" then
    local count = redis.call("INCR", successes_key)
    if count >= success_threshold then
        -- Recover to CLOSED
        redis.call("SET", state_key, "CLOSED")
        redis.call("DEL", opened_at_key)
        redis.call("DEL", failures_key)
        redis.call("DEL", probes_key)
        redis.call("DEL", successes_key)
        return {1, "CLOSED"}
    end
    return {0, "HALF_OPEN"}
end

return {0, state}
"""


# ─── Local In-Memory Fallback ────────────────────────────────────────────────
# Used if Redis is unreachable to avoid unbounded cascading failures or complete deadlock.
LOCAL_CIRCUITS: dict[str, dict[str, Any]] = {}
LOCAL_LOCK = asyncio.Lock()


def is_qualifying_failure(
    code_or_exc: Any = None,
    error: str | None = None,
    status_code: int | None = None,
    code: str | None = None,
) -> bool:
    """Determine whether an error is a systemic failure that should count toward tripping the circuit."""
    if isinstance(code_or_exc, BaseException):
        if isinstance(code_or_exc, (asyncio.CancelledError, ValueError, PermissionError)):
            return False
        if isinstance(code_or_exc, (TimeoutError, ConnectionRefusedError, ConnectionError, BrokenPipeError)):
            return True
        err_msg = str(code_or_exc).lower()
        if any(k in err_msg for k in ("404", "422", "ssrf", "unauthorized", "not found", "cancelled", "cancel")):
            return False
        if any(k in err_msg for k in ("503", "502", "504", "429", "timeout", "timed out", "bot", "connection refused", "service unavailable")):
            return True
        from backend.extractor_service import MediaExtractionError
        if isinstance(code_or_exc, MediaExtractionError):
            return True
    elif isinstance(code_or_exc, str) and code is None:
        code = code_or_exc

    c = str(code or "").strip().lower()
    if c in NON_QUALIFYING_CODES:
        return False
    if status_code and status_code in (400, 401, 403, 404, 409, 413, 422):
        return False

    if c in QUALIFYING_CODES:
        return True
    if status_code and status_code in (429, 500, 502, 503, 504):
        return True

    err_text = str(error or "").lower()
    if any(k in err_text for k in ("404", "422", "ssrf", "unauthorized")):
        return False
    if any(k in err_text for k in ("timeout", "timed out", "connection refused", "503", "502", "504", "too many requests", "service unavailable")):
        return True

    return False


# ─── Public API ──────────────────────────────────────────────────────────────

async def check_circuit(provider: str, domain: str = "upstream") -> CircuitCheckResult:
    """
    Check if the circuit for this provider is open.
    Returns CircuitCheckResult indicating if the request can proceed or must be rejected.
    """
    if not is_circuit_breaker_enabled():
        return CircuitCheckResult(allowed=True, state=CircuitState.CLOSED)

    prov = _sanitize_provider(provider)
    now = time.time()
    state_key, opened_at_key, failures_key, probes_key, successes_key = _circuit_keys(prov, domain)

    # 1. Try Redis Atomic Lua Check
    try:
        client_coro = _get_redis_client()
        redis_client = await asyncio.wait_for(client_coro, timeout=0.5) if asyncio.iscoroutine(client_coro) else client_coro
        if redis_client:
            res = await redis_client.eval(
                LUA_CHECK_STATE,
                3,
                state_key,
                opened_at_key,
                probes_key,
                now,
                OPEN_DURATION_SECONDS,
                HALF_OPEN_PROBES,
            )
            allowed = bool(res[0])
            st = CircuitState(str(res[1]))
            retry_after = int(res[2])
            is_probe = bool(res[3]) if len(res) > 3 else False

            if not allowed:
                try:
                    from backend.metrics import record_circuit_rejected
                    record_circuit_rejected(prov)
                except Exception:
                    pass
                return CircuitCheckResult(
                    allowed=False,
                    state=st,
                    retry_after=retry_after,
                    reason=f"Upstream provider '{prov}' circuit is {st.value}. Service temporarily unavailable.",
                )

            return CircuitCheckResult(
                allowed=True,
                state=st,
                is_probe=is_probe,
                reason="Admitted",
            )
    except Exception as exc:
        log.warning("Circuit breaker Redis check failed for %s (%s); evaluating local fallback", prov, exc)

    # 2. Local In-Memory Fallback
    return await _local_check_circuit(prov, domain)


async def record_failure(
    provider: str,
    domain: str = "upstream",
    code: str | None = None,
    error: str | None = None,
    status_code: int | None = None,
) -> bool:
    """
    Record a failure against this provider's circuit.
    If qualifying and threshold is reached, trips the circuit to OPEN.
    Returns True if circuit tripped.
    """
    if not is_circuit_breaker_enabled():
        return False

    if not is_qualifying_failure(code=code, error=error, status_code=status_code):
        log.debug("Non-qualifying failure ignored for circuit %s: code=%s", provider, code)
        return False

    prov = _sanitize_provider(provider)
    now = time.time()
    state_key, opened_at_key, failures_key, probes_key, successes_key = _circuit_keys(prov, domain)
    tripped = False

    try:
        client_coro = _get_redis_client()
        redis_client = await asyncio.wait_for(client_coro, timeout=0.5) if asyncio.iscoroutine(client_coro) else client_coro
        if redis_client:
            res = await redis_client.eval(
                LUA_RECORD_FAILURE,
                5,
                state_key,
                opened_at_key,
                failures_key,
                probes_key,
                successes_key,
                now,
                FAILURE_THRESHOLD,
                WINDOW_SECONDS,
                OPEN_DURATION_SECONDS,
            )
            tripped = bool(res[0])
            new_state = str(res[1])
            if tripped:
                log.warning("CIRCUIT TRIPPED to OPEN for provider '%s' (threshold=%d/%ds)", prov, FAILURE_THRESHOLD, WINDOW_SECONDS)
                try:
                    from backend.metrics import record_circuit_trip
                    record_circuit_trip(prov)
                except Exception:
                    pass
            return tripped
    except Exception as exc:
        log.warning("Circuit breaker Redis record_failure failed for %s: %s", prov, exc)

    # Local fallback
    return await _local_record_failure(prov, domain)


async def record_success(provider: str, domain: str = "upstream") -> bool:
    """
    Record a successful operation for this provider.
    In HALF_OPEN, increments success counter and transitions to CLOSED if threshold met.
    Returns True if circuit recovered.
    """
    if not is_circuit_breaker_enabled():
        return False

    prov = _sanitize_provider(provider)
    state_key, opened_at_key, failures_key, probes_key, successes_key = _circuit_keys(prov, domain)
    recovered = False

    try:
        client_coro = _get_redis_client()
        redis_client = await asyncio.wait_for(client_coro, timeout=0.5) if asyncio.iscoroutine(client_coro) else client_coro
        if redis_client:
            res = await redis_client.eval(
                LUA_RECORD_SUCCESS,
                5,
                state_key,
                opened_at_key,
                failures_key,
                probes_key,
                successes_key,
                SUCCESS_THRESHOLD,
            )
            recovered = bool(res[0])
            if recovered:
                log.info("CIRCUIT RECOVERED to CLOSED for provider '%s'", prov)
                try:
                    from backend.metrics import record_circuit_recovery
                    record_circuit_recovery(prov)
                except Exception:
                    pass
            return recovered
    except Exception as exc:
        log.warning("Circuit breaker Redis record_success failed for %s: %s", prov, exc)

    # Local fallback
    return await _local_record_success(prov, domain)


async def get_all_circuit_states() -> dict[str, str]:
    """Retrieve all provider circuit states for health & diagnostics."""
    states: dict[str, str] = {}
    from backend.metrics import ALLOWED_PROVIDERS

    try:
        client_coro = _get_redis_client()
        redis_client = await asyncio.wait_for(client_coro, timeout=0.5) if asyncio.iscoroutine(client_coro) else client_coro
        if redis_client:
            for prov in ALLOWED_PROVIDERS:
                if prov == "unknown":
                    continue
                state_key, _, _, _, _ = _circuit_keys(prov)
                val = await redis_client.get(state_key)
                states[prov] = str(val or "CLOSED").upper()
            return states
    except Exception:
        pass

    # Fallback to local memory
    async with LOCAL_LOCK:
        for prov in ALLOWED_PROVIDERS:
            if prov == "unknown":
                continue
            states[prov] = str(LOCAL_CIRCUITS.get(prov, {}).get("state", "CLOSED")).upper()

    return states


async def reset_circuit(provider: str, domain: str = "upstream") -> None:
    """Reset circuit to CLOSED (operational/test helper)."""
    prov = _sanitize_provider(provider)
    keys = _circuit_keys(prov, domain)
    try:
        client_coro = _get_redis_client()
        redis_client = await asyncio.wait_for(client_coro, timeout=0.5) if asyncio.iscoroutine(client_coro) else client_coro
        if redis_client:
            await redis_client.delete(*keys)
    except Exception:
        pass

    async with LOCAL_LOCK:
        LOCAL_CIRCUITS.pop(prov, None)

    try:
        from backend.metrics import update_circuit_state_metric
        update_circuit_state_metric(prov, "CLOSED")
    except Exception:
        pass


# ─── Local In-Memory Fallback Logic ──────────────────────────────────────────

async def _local_check_circuit(provider: str, domain: str) -> CircuitCheckResult:
    now = time.time()
    async with LOCAL_LOCK:
        info = LOCAL_CIRCUITS.setdefault(provider, {
            "state": CircuitState.CLOSED,
            "opened_at": 0.0,
            "failures": [],
            "probes": 0,
            "successes": 0,
        })
        st = info["state"]
        if st == CircuitState.CLOSED:
            return CircuitCheckResult(allowed=True, state=CircuitState.CLOSED)

        if st == CircuitState.OPEN:
            elapsed = now - info["opened_at"]
            if elapsed >= OPEN_DURATION_SECONDS:
                info["state"] = CircuitState.HALF_OPEN
                info["probes"] = 1
                info["successes"] = 0
                return CircuitCheckResult(allowed=True, state=CircuitState.HALF_OPEN, is_probe=True)
            retry_after = max(1, int(OPEN_DURATION_SECONDS - elapsed))
            return CircuitCheckResult(allowed=False, state=CircuitState.OPEN, retry_after=retry_after)

        if st == CircuitState.HALF_OPEN:
            if info["probes"] < HALF_OPEN_PROBES:
                info["probes"] += 1
                return CircuitCheckResult(allowed=True, state=CircuitState.HALF_OPEN, is_probe=True)
            return CircuitCheckResult(allowed=False, state=CircuitState.HALF_OPEN, retry_after=10)

    return CircuitCheckResult(allowed=True, state=CircuitState.CLOSED)


async def _local_record_failure(provider: str, domain: str) -> bool:
    now = time.time()
    async with LOCAL_LOCK:
        info = LOCAL_CIRCUITS.setdefault(provider, {
            "state": CircuitState.CLOSED,
            "opened_at": 0.0,
            "failures": [],
            "probes": 0,
            "successes": 0,
        })
        st = info["state"]
        if st == CircuitState.HALF_OPEN:
            info["state"] = CircuitState.OPEN
            info["opened_at"] = now
            info["probes"] = 0
            info["successes"] = 0
            return True

        if st == CircuitState.CLOSED:
            info["failures"].append(now)
            info["failures"] = [t for t in info["failures"] if now - t <= WINDOW_SECONDS]
            if len(info["failures"]) >= FAILURE_THRESHOLD:
                info["state"] = CircuitState.OPEN
                info["opened_at"] = now
                return True

    return False


async def _local_record_success(provider: str, domain: str) -> bool:
    async with LOCAL_LOCK:
        info = LOCAL_CIRCUITS.setdefault(provider, {
            "state": CircuitState.CLOSED,
            "opened_at": 0.0,
            "failures": [],
            "probes": 0,
            "successes": 0,
        })
        if info["state"] == CircuitState.HALF_OPEN:
            info["successes"] += 1
            if info["successes"] >= SUCCESS_THRESHOLD:
                info["state"] = CircuitState.CLOSED
                info["failures"] = []
                info["probes"] = 0
                info["successes"] = 0
                return True

    return False
