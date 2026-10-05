"""
NEXUS Phase 6 P0-2 — Global Admission Control & Dynamic Backpressure
====================================================================

Protects the NEXUS backend from saturation during high-concurrency spikes
and upstream provider throttling.

Key Capabilities:
-----------------
1. Per-User Concurrency Guard:
   Prevents any single tenant from monopolizing worker concurrency slots.
2. Global System Capacity Threshold:
   Enforces maximum active jobs across the entire cluster.
3. Queue Depth & Latency Backpressure:
   Monitors Celery/Redis queue lengths and defers/rejects requests when workers
   are saturated.
4. Fail-Safe Conservative Fallback:
   If Redis is unreachable, fails conservative using local process registry limits
   rather than permitting unbounded concurrency.
5. Safe Quota / Credit Recovery Compatibility:
   When admission rejects a request, credits reserved during middleware gate are
   safely refunded by the caller.

Feature Flag:
-------------
Gated by `NEXUS_ADMISSION_CONTROL_ENABLED` (default: false / 0).
When disabled, admission control immediately permits all requests (zero overhead).
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum
import logging
import os
import threading
import time
from typing import Any

from backend.api_v1.middleware import _get_redis_client

log = logging.getLogger("nexus.admission_control")

# ─── Configuration & Defaults ────────────────────────────────────────────────
def is_admission_control_enabled() -> bool:
    return os.environ.get("NEXUS_ADMISSION_CONTROL_ENABLED", "0").lower() in ("1", "true", "yes")

# Phase 6 P2.3: Resource-Aware Admission Feature Flag (Default False)
def is_resource_admission_enabled() -> bool:
    return os.environ.get("NEXUS_RESOURCE_ADMISSION_ENABLED", "0").lower() in ("1", "true", "yes")

def get_worker_max_cpu_percent() -> float:
    try:
        return float(os.environ.get("NEXUS_WORKER_MAX_CPU_PERCENT", "85.0"))
    except (ValueError, TypeError):
        return 85.0

def get_worker_min_free_memory_mb() -> float:
    try:
        return float(os.environ.get("NEXUS_WORKER_MIN_FREE_MEMORY_MB", "1536.0"))
    except (ValueError, TypeError):
        return 1536.0

def get_max_worker_execution_slots() -> int:
    try:
        return int(os.environ.get("NEXUS_MAX_WORKER_EXECUTION_SLOTS", "4"))
    except (ValueError, TypeError):
        return 4

MAX_GLOBAL_CONCURRENT_JOBS = int(os.environ.get("NEXUS_MAX_GLOBAL_CONCURRENT_JOBS", "50"))
MAX_USER_CONCURRENT_JOBS = int(os.environ.get("NEXUS_MAX_USER_CONCURRENT_JOBS", "3"))
MAX_QUEUE_DEPTH = int(os.environ.get("NEXUS_MAX_QUEUE_DEPTH", "100"))
MAX_OLD_JOB_AGE_SECONDS = int(os.environ.get("NEXUS_MAX_OLD_JOB_AGE_SECONDS", "300"))
LOCAL_FALLBACK_MAX_CONCURRENCY = int(os.environ.get("NEXUS_LOCAL_FALLBACK_MAX_CONCURRENCY", "10"))

ACTIVE_JOB_STATUSES = frozenset({"queued", "extracting", "downloading", "processing", "uploading"})


class AdmissionDecision(str, Enum):
    ACCEPT = "ACCEPT"
    DEFER = "DEFER"
    REJECT_USER_LIMIT = "REJECT_USER_LIMIT"
    REJECT_GLOBAL_CAPACITY = "REJECT_GLOBAL_CAPACITY"
    REJECT_RESOURCE_EXHAUSTION = "REJECT_RESOURCE_EXHAUSTION"
    DEFER_RESOURCE_PRESSURE = "DEFER_RESOURCE_PRESSURE"


@dataclass(frozen=True)
class AdmissionResult:
    allowed: bool
    decision: AdmissionDecision
    status_code: int = 200
    reason: str = "Admitted"
    retry_after: int = 0


# ─── Resource Sampling & Race-Safe Reservation Gate ─────────────────────────

@dataclass(frozen=True)
class SystemResourceSnapshot:
    cpu_percent: float
    available_memory_mb: float
    total_memory_mb: float
    timestamp: float
    healthy: bool
    detail: str = "ok"


_RESOURCE_SNAPSHOT_CACHE: SystemResourceSnapshot | None = None
_RESOURCE_CACHE_LOCK = threading.Lock()
RESOURCE_CACHE_TTL_SECONDS = 1.0


def get_system_resource_snapshot(force_refresh: bool = False) -> SystemResourceSnapshot:
    """
    Sample host system CPU and RAM using psutil with bounded execution time.
    Cached for ~1.0s to prevent high-frequency syscall storms under heavy API load.
    Returns conservative snapshot if metrics cannot be sampled.
    """
    global _RESOURCE_SNAPSHOT_CACHE
    now = time.time()
    with _RESOURCE_CACHE_LOCK:
        if (
            not force_refresh
            and _RESOURCE_SNAPSHOT_CACHE is not None
            and (now - _RESOURCE_SNAPSHOT_CACHE.timestamp) < RESOURCE_CACHE_TTL_SECONDS
        ):
            return _RESOURCE_SNAPSHOT_CACHE

    try:
        import psutil
        # Non-blocking CPU measurement (uses delta since last call)
        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        avail_mb = mem.available / (1024.0 * 1024.0)
        tot_mb = mem.total / (1024.0 * 1024.0)

        snapshot = SystemResourceSnapshot(
            cpu_percent=float(cpu),
            available_memory_mb=float(avail_mb),
            total_memory_mb=float(tot_mb),
            timestamp=now,
            healthy=True,
            detail="ok",
        )
    except Exception as exc:
        log.warning("Failed to collect psutil system metrics (%s); returning conservative snapshot", exc)
        snapshot = SystemResourceSnapshot(
            cpu_percent=0.0,
            available_memory_mb=0.0,
            total_memory_mb=0.0,
            timestamp=now,
            healthy=False,
            detail=f"metrics_unavailable: {exc}",
        )

    with _RESOURCE_CACHE_LOCK:
        _RESOURCE_SNAPSHOT_CACHE = snapshot
    return snapshot


class WorkerExecutionReservationManager:
    """
    Critical Correction 1: Process-safe local execution slot reservation gate.
    Prevents race conditions where concurrent jobs sample CPU at 40%, pass,
    and simultaneously spawn heavy FFmpeg processes.
    """
    def __init__(self, max_slots: int | None = None):
        self._lock = threading.Lock()
        self._active_reservations: set[str] = set()
        self._override_max_slots = max_slots

    @property
    def max_slots(self) -> int:
        if self._override_max_slots is not None:
            return self._override_max_slots
        return get_max_worker_execution_slots()

    def active_count(self) -> int:
        with self._lock:
            return len(self._active_reservations)

    def is_reserved(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._active_reservations

    def try_reserve_slot(self, job_id: str) -> tuple[bool, str]:
        """
        Atomically reserve a worker execution slot after verifying
        both slot capacity and host system resources.
        
        Flow:
        1. Capacity check
        2. Resource snapshot check
        3. Atomic reservation
        4. Re-check critical resource state
        """
        with self._lock:
            if job_id in self._active_reservations:
                return True, "already_reserved"

            # Check slot capacity
            current_active = len(self._active_reservations)
            if current_active >= self.max_slots:
                return False, f"slot_limit_reached ({current_active}/{self.max_slots})"

            # If resource admission is enabled, check host resources
            if is_resource_admission_enabled():
                snapshot = get_system_resource_snapshot()
                if not snapshot.healthy:
                    # Conservative fallback: if metrics unavailable, cap to conservative limit
                    if current_active >= min(self.max_slots, 2):
                        return False, "metrics_unavailable_conservative_cap"
                else:
                    max_cpu = get_worker_max_cpu_percent()
                    min_ram = get_worker_min_free_memory_mb()
                    if snapshot.cpu_percent >= max_cpu:
                        return False, f"cpu_pressure ({snapshot.cpu_percent:.1f}% >= {max_cpu:.1f}%)"
                    if snapshot.available_memory_mb < min_ram:
                        return False, f"memory_pressure ({snapshot.available_memory_mb:.1f}MB < {min_ram:.1f}MB)"

            # Atomically add reservation
            self._active_reservations.add(job_id)

            # Re-check critical resource state if enabled
            if is_resource_admission_enabled():
                crit_snapshot = get_system_resource_snapshot(force_refresh=True)
                if crit_snapshot.healthy:
                    crit_max_cpu = min(98.0, get_worker_max_cpu_percent() + 10.0)
                    crit_min_ram = max(256.0, get_worker_min_free_memory_mb() * 0.5)
                    if crit_snapshot.cpu_percent >= crit_max_cpu or crit_snapshot.available_memory_mb < crit_min_ram:
                        # Rollback reservation
                        self._active_reservations.discard(job_id)
                        return False, "critical_resource_spike_detected"

            return True, "reserved"

    def release_slot(self, job_id: str) -> None:
        """Release the execution slot in all success/failure/cancellation paths."""
        with self._lock:
            self._active_reservations.discard(job_id)

    def reset(self) -> None:
        """Reset state for clean test isolation."""
        with self._lock:
            self._active_reservations.clear()


_EXECUTION_RESERVATION_MGR = WorkerExecutionReservationManager()


def try_reserve_worker_execution_slot(job_id: str) -> tuple[bool, str]:
    return _EXECUTION_RESERVATION_MGR.try_reserve_slot(job_id)


def release_worker_execution_slot(job_id: str) -> None:
    _EXECUTION_RESERVATION_MGR.release_slot(job_id)


def get_active_worker_execution_count() -> int:
    return _EXECUTION_RESERVATION_MGR.active_count()


def reset_worker_execution_reservations() -> None:
    _EXECUTION_RESERVATION_MGR.reset()


# ─── Admission Evaluation ────────────────────────────────────────────────────

async def evaluate_admission(
    user_id: str | None,
    queue_name: str = "free_consumer",
) -> AdmissionResult:
    """
    Evaluate whether a new download request can be admitted into the system.

    Returns AdmissionResult indicating whether to allow, defer, or reject the job.
    """
    if not is_admission_control_enabled():
        return AdmissionResult(allowed=True, decision=AdmissionDecision.ACCEPT)

    # 1. Per-User Concurrency Limit
    if user_id and str(user_id) not in ("anon", "anonymous", ""):
        user_active_count = await _count_user_active_jobs(str(user_id))
        if user_active_count >= MAX_USER_CONCURRENT_JOBS:
            log.warning(
                "Admission rejected: user %s has %d active jobs (max %d)",
                user_id, user_active_count, MAX_USER_CONCURRENT_JOBS,
            )
            try:
                from backend.metrics import record_admission_rejected
                record_admission_rejected("user_concurrency_limit")
            except Exception:
                pass
            return AdmissionResult(
                allowed=False,
                decision=AdmissionDecision.REJECT_USER_LIMIT,
                status_code=429,
                reason=f"User concurrent download limit of {MAX_USER_CONCURRENT_JOBS} reached. Please wait for current downloads to complete.",
                retry_after=15,
            )

    # 2. Global Concurrency & Active Process Slots
    global_active_count = await _count_global_active_jobs()
    if global_active_count >= MAX_GLOBAL_CONCURRENT_JOBS:
        log.warning(
            "Admission rejected: global active jobs %d reached limit %d",
            global_active_count, MAX_GLOBAL_CONCURRENT_JOBS,
        )
        try:
            from backend.metrics import record_admission_rejected
            record_admission_rejected("global_capacity_limit")
        except Exception:
            pass
        return AdmissionResult(
            allowed=False,
            decision=AdmissionDecision.REJECT_GLOBAL_CAPACITY,
            status_code=503,
            reason="Server capacity reached. System is under heavy load, please try again shortly.",
            retry_after=30,
        )

    # 3. Host System Resource Admission Guard (CPU & Memory)
    if is_resource_admission_enabled():
        snapshot = get_system_resource_snapshot()
        if not snapshot.healthy:
            # Conservative fallback: if metrics cannot be sampled, fallback to conservative process limits
            local_res = _conservative_local_fallback()
            if not local_res.allowed:
                try:
                    from backend.metrics import record_resource_admission_rejected
                    record_resource_admission_rejected("psutil_unavailable")
                except Exception:
                    pass
                return local_res
        else:
            max_cpu = get_worker_max_cpu_percent()
            min_ram = get_worker_min_free_memory_mb()
            if snapshot.cpu_percent >= max_cpu:
                log.warning("Admission rejected: host CPU %.1f%% >= threshold %.1f%%", snapshot.cpu_percent, max_cpu)
                try:
                    from backend.metrics import record_resource_admission_rejected
                    record_resource_admission_rejected("cpu_exhaustion")
                except Exception:
                    pass
                return AdmissionResult(
                    allowed=False,
                    decision=AdmissionDecision.REJECT_RESOURCE_EXHAUSTION,
                    status_code=503,
                    reason=f"System CPU utilization ({snapshot.cpu_percent:.1f}%) exceeds operating threshold ({max_cpu:.1f}%). Please retry shortly.",
                    retry_after=15,
                )
            if snapshot.available_memory_mb < min_ram:
                log.warning("Admission rejected: available RAM %.1fMB < threshold %.1fMB", snapshot.available_memory_mb, min_ram)
                try:
                    from backend.metrics import record_resource_admission_rejected
                    record_resource_admission_rejected("memory_exhaustion")
                except Exception:
                    pass
                return AdmissionResult(
                    allowed=False,
                    decision=AdmissionDecision.REJECT_RESOURCE_EXHAUSTION,
                    status_code=503,
                    reason=f"Available system memory ({snapshot.available_memory_mb:.0f}MB) is below safe processing headroom ({min_ram:.0f}MB). Please retry shortly.",
                    retry_after=20,
                )

    # 4. Queue Depth & Oldest Job Backpressure
    queue_check = await _check_queue_backpressure(queue_name)
    if not queue_check.allowed:
        return queue_check

    # Admitted
    try:
        from backend.metrics import record_admission_admitted
        record_admission_admitted()
    except Exception:
        pass

    return AdmissionResult(
        allowed=True,
        decision=AdmissionDecision.ACCEPT,
        status_code=200,
        reason="Admitted",
    )


# ─── Cluster-Wide Distributed Active Tracking (Multi-Process Safe) ───────────
REDIS_GLOBAL_ACTIVE_KEY = "nexus:admission:active_jobs"
REDIS_USER_ACTIVE_KEY_PREFIX = "nexus:admission:user"


async def register_active_job_admission(
    job_id: str,
    user_id: str | None = None,
    ttl_seconds: int = 1800,
) -> None:
    """
    Register a newly admitted job in the cluster-wide active set in Redis.
    Guarantees cross-process visibility across all uvicorn workers and nodes.
    """
    now_ms = time.time() * 1000
    expire_at = now_ms + (ttl_seconds * 1000)
    try:
        client_coro = _get_redis_client()
        redis_client = await asyncio.wait_for(client_coro, timeout=0.5) if asyncio.iscoroutine(client_coro) else client_coro
        if redis_client:
            # 1. Global active sorted set (score = expire_at)
            pipe = redis_client.pipeline()
            pipe.zremrangebyscore(REDIS_GLOBAL_ACTIVE_KEY, "-inf", now_ms)
            pipe.zadd(REDIS_GLOBAL_ACTIVE_KEY, {job_id: expire_at})
            pipe.expire(REDIS_GLOBAL_ACTIVE_KEY, ttl_seconds + 60)

            # 2. Per-user active sorted set
            if user_id and str(user_id) not in ("anon", "anonymous", ""):
                user_key = f"{REDIS_USER_ACTIVE_KEY_PREFIX}:{user_id}:active"
                pipe.zremrangebyscore(user_key, "-inf", now_ms)
                pipe.zadd(user_key, {job_id: expire_at})
                pipe.expire(user_key, ttl_seconds + 60)

            await pipe.execute()
    except Exception as exc:
        log.debug("Redis active job registration skipped for %s: %s", job_id, exc)


async def deregister_active_job_admission(
    job_id: str,
    user_id: str | None = None,
) -> None:
    """
    Deregister a completed/failed/cancelled job from cluster-wide active sets.
    """
    try:
        client_coro = _get_redis_client()
        redis_client = await asyncio.wait_for(client_coro, timeout=0.5) if asyncio.iscoroutine(client_coro) else client_coro
        if redis_client:
            pipe = redis_client.pipeline()
            pipe.zrem(REDIS_GLOBAL_ACTIVE_KEY, job_id)
            if user_id and str(user_id) not in ("anon", "anonymous", ""):
                pipe.zrem(f"{REDIS_USER_ACTIVE_KEY_PREFIX}:{user_id}:active", job_id)
            await pipe.execute()
    except Exception as exc:
        log.debug("Redis active job deregistration skipped for %s: %s", job_id, exc)


# ─── Internal Inspection Helpers ─────────────────────────────────────────────

async def _count_user_active_jobs(user_id: str) -> int:
    """Count active jobs currently registered for this user across all processes/nodes."""
    now_ms = time.time() * 1000

    # 1. Check Redis distributed sorted set first (Cluster-Wide)
    try:
        client_coro = _get_redis_client()
        redis_client = await asyncio.wait_for(client_coro, timeout=0.5) if asyncio.iscoroutine(client_coro) else client_coro
        if redis_client:
            user_key = f"{REDIS_USER_ACTIVE_KEY_PREFIX}:{user_id}:active"
            pipe = redis_client.pipeline()
            pipe.zremrangebyscore(user_key, "-inf", now_ms)
            pipe.zcard(user_key)
            results = await pipe.execute()
            redis_count = int(results[1]) if len(results) > 1 else 0
            if redis_count > 0:
                return redis_count
    except Exception:
        pass

    # 2. Check in-memory state
    try:
        from backend.job_store import JOB_RUNTIME_STATE
        mem_count = sum(
            1 for state in JOB_RUNTIME_STATE.values()
            if str(state.get("user_id") or "") == user_id
            and str(state.get("status") or "").lower() in ACTIVE_JOB_STATUSES
        )
        if mem_count > 0:
            return mem_count
    except Exception:
        pass

    # 3. Check Supabase/PostgreSQL if configured
    try:
        from backend.job_outbox import _get_supabase
        supabase = _get_supabase()
        if supabase:
            res = await asyncio.to_thread(
                lambda: supabase.table("jobs")
                    .select("id", count="exact")
                    .eq("user_id", user_id)
                    .in_("status", list(ACTIVE_JOB_STATUSES))
                    .execute()
            )
            if hasattr(res, "count") and res.count is not None:
                return res.count
            return len(res.data or [])
    except Exception as exc:
        log.debug("User active jobs DB query failed for %s: %s", user_id, exc)

    return 0


async def _count_global_active_jobs() -> int:
    """
    Count total active jobs across the entire cluster.
    Synchronized via Redis, with PostgreSQL and in-memory fallbacks.
    """
    now_ms = time.time() * 1000
    count = 0

    # 1. Query Redis distributed active set (Multi-Process & Multi-Node Source of Truth)
    try:
        client_coro = _get_redis_client()
        redis_client = await asyncio.wait_for(client_coro, timeout=0.5) if asyncio.iscoroutine(client_coro) else client_coro
        if redis_client:
            pipe = redis_client.pipeline()
            pipe.zremrangebyscore(REDIS_GLOBAL_ACTIVE_KEY, "-inf", now_ms)
            pipe.zcard(REDIS_GLOBAL_ACTIVE_KEY)
            results = await pipe.execute()
            redis_active = int(results[1]) if len(results) > 1 else 0
            count = max(count, redis_active)
    except Exception:
        pass

    # 2. Check local active FFmpeg processes on this host
    try:
        from backend.download_handler import ACTIVE_PROCESSES
        count = max(count, len(ACTIVE_PROCESSES))
    except Exception:
        pass

    # 3. Check in-memory job store on this process
    try:
        from backend.job_store import JOB_RUNTIME_STATE
        mem_active = sum(
            1 for state in JOB_RUNTIME_STATE.values()
            if str(state.get("status") or "").lower() in ACTIVE_JOB_STATUSES
        )
        count = max(count, mem_active)
    except Exception:
        pass

    return count


async def _check_queue_backpressure(queue_name: str) -> AdmissionResult:
    """Check Celery/Redis queue depth and latency backpressure."""
    try:
        client_coro = _get_redis_client()
        redis_client = await asyncio.wait_for(client_coro, timeout=1.0) if asyncio.iscoroutine(client_coro) else client_coro
        if not redis_client:
            return _conservative_local_fallback()

        try:
            await asyncio.wait_for(redis_client.ping(), timeout=0.2)
        except Exception as exc:
            log.warning("Admission control: Redis ping failed (%s); applying conservative fallback", exc)
            return _conservative_local_fallback()

        # Check total depth across all primary worker queues
        total_depth = 0
        queues_to_check = [queue_name, "render", "free_consumer", "priority_consumer"]
        seen = set()
        for q in queues_to_check:
            if q in seen:
                continue
            seen.add(q)
            try:
                d = await asyncio.wait_for(redis_client.llen(q), timeout=0.5)
                total_depth += d
            except Exception:
                pass

        if total_depth >= MAX_QUEUE_DEPTH:
            log.warning("Admission rejected: queue depth %d exceeds threshold %d", total_depth, MAX_QUEUE_DEPTH)
            try:
                from backend.metrics import record_admission_rejected
                record_admission_rejected("queue_depth_exceeded")
            except Exception:
                pass
            return AdmissionResult(
                allowed=False,
                decision=AdmissionDecision.REJECT_GLOBAL_CAPACITY,
                status_code=503,
                reason="Worker queue is saturated. Please try again shortly.",
                retry_after=30,
            )

    except Exception as exc:
        log.warning("Admission control: Redis queue check failed (%s); applying conservative fallback", exc)
        return _conservative_local_fallback()

    return AdmissionResult(allowed=True, decision=AdmissionDecision.ACCEPT)


def _conservative_local_fallback() -> AdmissionResult:
    """
    Fail-safe conservative fallback when Redis is unreachable.
    Caps concurrency based on local active processes.
    """
    try:
        from backend.download_handler import ACTIVE_PROCESSES
        active_len = len(ACTIVE_PROCESSES)
        if active_len >= LOCAL_FALLBACK_MAX_CONCURRENCY:
            log.warning(
                "Admission fallback: active processes %d >= fallback limit %d",
                active_len, LOCAL_FALLBACK_MAX_CONCURRENCY,
            )
            try:
                from backend.metrics import record_admission_rejected
                record_admission_rejected("global_capacity_limit")
            except Exception:
                pass
            return AdmissionResult(
                allowed=False,
                decision=AdmissionDecision.REJECT_GLOBAL_CAPACITY,
                status_code=503,
                reason="System capacity reached during temporary coordination degradation. Please retry shortly.",
                retry_after=20,
            )
    except Exception:
        pass

    return AdmissionResult(allowed=True, decision=AdmissionDecision.ACCEPT)
