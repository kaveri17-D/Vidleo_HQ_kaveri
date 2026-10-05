"""
NEXUS Phase 6 P0-3 — Distributed Metrics Exporter
==================================================

Prometheus-compatible distributed metrics exporter for critical NEXUS backend
signals: job lifecycle, outbox state, queue backpressure, admission control,
FFmpeg concurrency, and reservation recovery.

Cardinality Safety:
-------------------
All labels are strictly bounded to small, static enumerations (strategy, provider,
failure_category, reason, queue_name). Arbitrary dynamic data such as job_id,
user_id, IP addresses, URLs, and raw error messages are NEVER placed in metric
labels.

Feature Flag:
-------------
Gated by `NEXUS_METRICS_ENABLED` (default: false / 0).
When disabled, the `/metrics` endpoint returns 404, and instrumentation has zero
overhead.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

log = logging.getLogger("nexus.metrics")

# Feature Flag (Default False)
METRICS_ENABLED = os.environ.get("NEXUS_METRICS_ENABLED", "0").lower() in ("1", "true", "yes")

def is_metrics_enabled() -> bool:
    return os.environ.get("NEXUS_METRICS_ENABLED", "0").lower() in ("1", "true", "yes")


# ─── Cardinality Boundary Sets ────────────────────────────────────────────────
ALLOWED_STRATEGIES = frozenset({
    "direct_progressive",
    "direct_range",
    "browser_adaptive_mux",
    "signed_worker_range",
    "browser_hls",
    "server_fallback",
    "unknown",
})

ALLOWED_PROVIDERS = frozenset({
    "youtube",
    "instagram",
    "tiktok",
    "twitter",
    "reddit",
    "facebook",
    "vimeo",
    "twitch",
    "generic",
    "unknown",
})

ALLOWED_FAILURES = frozenset({
    "download_timeout",
    "process_error",
    "storage_error",
    "validation_error",
    "upstream_error",
    "dispatch_fallback",
    "cancelled",
    "unknown",
})

ALLOWED_REASONS = frozenset({
    "user_concurrency_limit",
    "global_capacity_limit",
    "queue_depth_exceeded",
    "backpressure_delay",
    "unknown",
})

ALLOWED_QUEUES = frozenset({
    "render",
    "free_consumer",
    "priority_consumer",
    "meta",
    "celery",
    "maintenance_worker",
    "default",
    "unknown",
})

ALLOWED_SCALE_DIRECTIONS = frozenset({
    "up",
    "down",
    "unknown",
})

ALLOWED_RESOURCE_REASONS = frozenset({
    "cpu_exhaustion",
    "memory_exhaustion",
    "slot_exhaustion",
    "psutil_unavailable",
    "critical_spike",
    "unknown",
})


def _sanitize(val: Any, allowed: frozenset[str], default: str = "unknown") -> str:
    """Sanitize label value to prevent metric cardinality explosion."""
    if not val:
        return default
    s = str(val).strip().lower()
    return s if s in allowed else default


# ─── Prometheus Metric Definitions ───────────────────────────────────────────
try:
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        CollectorRegistry,
        Counter,
        Gauge,
        REGISTRY,
        generate_latest,
    )
    _prom_available = True
except Exception:  # pragma: no cover
    _prom_available = False
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"

    class _NoopMetric:
        def labels(self, *args, **kwargs):
            return self
        def inc(self, *args, **kwargs):
            pass
        def dec(self, *args, **kwargs):
            pass
        def set(self, *args, **kwargs):
            pass

    Counter = Gauge = lambda *args, **kwargs: _NoopMetric()  # type: ignore
    generate_latest = lambda *args, **kwargs: b""  # type: ignore
    REGISTRY = None  # type: ignore


if _prom_available:
    # ── Counters ─────────────────────────────────────────────────────────────
    NEXUS_JOB_CREATED_TOTAL = Counter(
        "nexus_job_created_total",
        "Total download jobs created",
        ["strategy", "provider"],
    )

    NEXUS_JOB_COMPLETED_TOTAL = Counter(
        "nexus_job_completed_total",
        "Total download jobs successfully completed",
        ["strategy", "provider"],
    )

    NEXUS_JOB_FAILED_TOTAL = Counter(
        "nexus_job_failed_total",
        "Total download jobs failed",
        ["strategy", "provider", "failure_category"],
    )

    NEXUS_JOB_CANCELLED_TOTAL = Counter(
        "nexus_job_cancelled_total",
        "Total download jobs cancelled by client or owner",
    )

    NEXUS_OUTBOX_PRUNED_TOTAL = Counter(
        "nexus_outbox_pruned_total",
        "Total outbox records pruned by retention policy",
    )

    NEXUS_RESERVATION_REFUND_TOTAL = Counter(
        "nexus_reservation_refund_total",
        "Total credit reservations refunded",
    )

    NEXUS_FFMPEG_TIMEOUT_TOTAL = Counter(
        "nexus_ffmpeg_timeout_total",
        "Total FFmpeg download processes killed due to timeout",
    )

    NEXUS_ADMISSION_ADMITTED_TOTAL = Counter(
        "nexus_admission_admitted_total",
        "Total jobs admitted by admission control",
    )

    NEXUS_ADMISSION_REJECTED_TOTAL = Counter(
        "nexus_admission_rejected_total",
        "Total jobs rejected by admission control",
        ["reason"],
    )

    NEXUS_ADMISSION_DEFERRED_TOTAL = Counter(
        "nexus_admission_deferred_total",
        "Total jobs deferred by admission control backpressure",
    )

    # ── Gauges ───────────────────────────────────────────────────────────────
    NEXUS_QUEUE_DEPTH = Gauge(
        "nexus_queue_depth",
        "Current depth of Celery/work queues",
        ["queue_name"],
    )

    NEXUS_QUEUE_OLDEST_AGE_SECONDS = Gauge(
        "nexus_queue_oldest_age_seconds",
        "Age of oldest waiting item in queue in seconds",
        ["queue_name"],
    )

    NEXUS_JOBS_RUNNING = Gauge(
        "nexus_jobs_running",
        "Number of currently active/running jobs",
    )

    NEXUS_FFMPEG_RUNNING = Gauge(
        "nexus_ffmpeg_running",
        "Number of currently active FFmpeg subprocesses",
    )

    NEXUS_OUTBOX_PENDING = Gauge(
        "nexus_outbox_pending",
        "Number of pending rows in transactional outbox",
    )

    NEXUS_OUTBOX_FAILED = Gauge(
        "nexus_outbox_failed",
        "Number of exhausted/failed rows in transactional outbox",
    )

    # ── Phase 6 P1-1: Circuit Breaker Metrics ─────────────────────────────────
    NEXUS_CIRCUIT_STATE = Gauge(
        "nexus_circuit_state",
        "Current state of circuit breaker (0=CLOSED, 1=HALF_OPEN, 2=OPEN)",
        ["provider"],
    )

    NEXUS_CIRCUIT_OPEN_TOTAL = Counter(
        "nexus_circuit_open_total",
        "Total times circuit entered OPEN state",
        ["provider"],
    )

    NEXUS_CIRCUIT_TRIP_TOTAL = Counter(
        "nexus_circuit_trip_total",
        "Total circuit trip events due to threshold breaches",
        ["provider"],
    )

    NEXUS_CIRCUIT_RECOVERY_TOTAL = Counter(
        "nexus_circuit_recovery_total",
        "Total times circuit recovered to CLOSED state",
        ["provider"],
    )

    NEXUS_CIRCUIT_REJECTED_TOTAL = Counter(
        "nexus_circuit_rejected_total",
        "Total requests rejected while circuit was OPEN",
        ["provider"],
    )

    # ── Phase 6 P2.3: Dynamic Worker Scaling & Resource Admission Metrics ──
    NEXUS_WORKER_DESIRED = Gauge(
        "nexus_worker_desired",
        "Desired count of render workers calculated by autoscaler",
    )

    NEXUS_WORKER_ACTIVE = Gauge(
        "nexus_worker_active",
        "Active count of render workers running in cluster",
    )

    NEXUS_WORKER_SCALE_EVENTS_TOTAL = Counter(
        "nexus_worker_scale_events_total",
        "Autoscaling scale-up/scale-down events",
        ["direction"],
    )

    NEXUS_RESOURCE_REJECTION_TOTAL = Counter(
        "nexus_resource_rejection_total",
        "Total requests rejected due to host resource limits",
        ["reason"],
    )

    NEXUS_RESOURCE_DEFER_TOTAL = Counter(
        "nexus_resource_defer_total",
        "Total requests deferred due to host resource limits",
        ["reason"],
    )

    NEXUS_HOST_CPU_UTILIZATION_RATIO = Gauge(
        "nexus_host_cpu_utilization_ratio",
        "Host CPU utilization ratio (0.0 to 1.0)",
    )

    NEXUS_HOST_MEMORY_AVAILABLE_BYTES = Gauge(
        "nexus_host_memory_available_bytes",
        "Host available RAM in bytes",
    )
else:
    NEXUS_JOB_CREATED_TOTAL = _NoopMetric()
    NEXUS_JOB_COMPLETED_TOTAL = _NoopMetric()
    NEXUS_JOB_FAILED_TOTAL = _NoopMetric()
    NEXUS_JOB_CANCELLED_TOTAL = _NoopMetric()
    NEXUS_OUTBOX_PRUNED_TOTAL = _NoopMetric()
    NEXUS_RESERVATION_REFUND_TOTAL = _NoopMetric()
    NEXUS_FFMPEG_TIMEOUT_TOTAL = _NoopMetric()
    NEXUS_ADMISSION_ADMITTED_TOTAL = _NoopMetric()
    NEXUS_ADMISSION_REJECTED_TOTAL = _NoopMetric()
    NEXUS_ADMISSION_DEFERRED_TOTAL = _NoopMetric()

    NEXUS_QUEUE_DEPTH = _NoopMetric()
    NEXUS_QUEUE_OLDEST_AGE_SECONDS = _NoopMetric()
    NEXUS_JOBS_RUNNING = _NoopMetric()
    NEXUS_FFMPEG_RUNNING = _NoopMetric()
    NEXUS_OUTBOX_PENDING = _NoopMetric()
    NEXUS_OUTBOX_FAILED = _NoopMetric()
    NEXUS_CIRCUIT_STATE = _NoopMetric()
    NEXUS_CIRCUIT_OPEN_TOTAL = _NoopMetric()
    NEXUS_CIRCUIT_TRIP_TOTAL = _NoopMetric()
    NEXUS_CIRCUIT_RECOVERY_TOTAL = _NoopMetric()
    NEXUS_CIRCUIT_REJECTED_TOTAL = _NoopMetric()

    NEXUS_WORKER_DESIRED = _NoopMetric()
    NEXUS_WORKER_ACTIVE = _NoopMetric()
    NEXUS_WORKER_SCALE_EVENTS_TOTAL = _NoopMetric()
    NEXUS_RESOURCE_REJECTION_TOTAL = _NoopMetric()
    NEXUS_RESOURCE_DEFER_TOTAL = _NoopMetric()
    NEXUS_HOST_CPU_UTILIZATION_RATIO = _NoopMetric()
    NEXUS_HOST_MEMORY_AVAILABLE_BYTES = _NoopMetric()


# ─── Safe Recording Public Helpers ───────────────────────────────────────────
# All helpers are wrapped in try/except to ensure metric recording NEVER breaks
# core application logic.

def record_job_created(strategy: str = "server_fallback", provider: str = "generic") -> None:
    try:
        strat = _sanitize(strategy, ALLOWED_STRATEGIES, "server_fallback")
        prov = _sanitize(provider, ALLOWED_PROVIDERS, "generic")
        NEXUS_JOB_CREATED_TOTAL.labels(strategy=strat, provider=prov).inc()
    except Exception as exc:
        log.debug("record_job_created metric error: %s", exc)


def record_job_completed(strategy: str = "server_fallback", provider: str = "generic") -> None:
    try:
        strat = _sanitize(strategy, ALLOWED_STRATEGIES, "server_fallback")
        prov = _sanitize(provider, ALLOWED_PROVIDERS, "generic")
        NEXUS_JOB_COMPLETED_TOTAL.labels(strategy=strat, provider=prov).inc()
    except Exception as exc:
        log.debug("record_job_completed metric error: %s", exc)


def record_job_failed(strategy: str = "server_fallback", provider: str = "generic", failure_category: str = "unknown") -> None:
    try:
        strat = _sanitize(strategy, ALLOWED_STRATEGIES, "server_fallback")
        prov = _sanitize(provider, ALLOWED_PROVIDERS, "generic")
        cat = _sanitize(failure_category, ALLOWED_FAILURES, "unknown")
        NEXUS_JOB_FAILED_TOTAL.labels(strategy=strat, provider=prov, failure_category=cat).inc()
    except Exception as exc:
        log.debug("record_job_failed metric error: %s", exc)


def record_job_cancelled() -> None:
    try:
        NEXUS_JOB_CANCELLED_TOTAL.inc()
    except Exception as exc:
        log.debug("record_job_cancelled metric error: %s", exc)


def record_outbox_pruned(count: int = 1) -> None:
    try:
        if count > 0:
            NEXUS_OUTBOX_PRUNED_TOTAL.inc(count)
    except Exception as exc:
        log.debug("record_outbox_pruned metric error: %s", exc)


def record_reservation_refund(count: int = 1) -> None:
    try:
        if count > 0:
            NEXUS_RESERVATION_REFUND_TOTAL.inc(count)
    except Exception as exc:
        log.debug("record_reservation_refund metric error: %s", exc)


def record_ffmpeg_timeout() -> None:
    try:
        NEXUS_FFMPEG_TIMEOUT_TOTAL.inc()
    except Exception as exc:
        log.debug("record_ffmpeg_timeout metric error: %s", exc)


def record_admission_admitted() -> None:
    try:
        NEXUS_ADMISSION_ADMITTED_TOTAL.inc()
    except Exception as exc:
        log.debug("record_admission_admitted metric error: %s", exc)


def record_admission_rejected(reason: str = "unknown") -> None:
    try:
        r = _sanitize(reason, ALLOWED_REASONS, "unknown")
        NEXUS_ADMISSION_REJECTED_TOTAL.labels(reason=r).inc()
    except Exception as exc:
        log.debug("record_admission_rejected metric error: %s", exc)


def record_admission_deferred() -> None:
    try:
        NEXUS_ADMISSION_DEFERRED_TOTAL.inc()
    except Exception as exc:
        log.debug("record_admission_deferred metric error: %s", exc)


def record_circuit_trip(provider: str = "generic") -> None:
    try:
        prov = _sanitize(provider, ALLOWED_PROVIDERS, "generic")
        NEXUS_CIRCUIT_TRIP_TOTAL.labels(provider=prov).inc()
        NEXUS_CIRCUIT_OPEN_TOTAL.labels(provider=prov).inc()
        NEXUS_CIRCUIT_STATE.labels(provider=prov).set(2.0)  # 2 = OPEN
    except Exception as exc:
        log.debug("record_circuit_trip metric error: %s", exc)


def record_circuit_recovery(provider: str = "generic") -> None:
    try:
        prov = _sanitize(provider, ALLOWED_PROVIDERS, "generic")
        NEXUS_CIRCUIT_RECOVERY_TOTAL.labels(provider=prov).inc()
        NEXUS_CIRCUIT_STATE.labels(provider=prov).set(0.0)  # 0 = CLOSED
    except Exception as exc:
        log.debug("record_circuit_recovery metric error: %s", exc)


def record_circuit_rejected(provider: str = "generic") -> None:
    try:
        prov = _sanitize(provider, ALLOWED_PROVIDERS, "generic")
        NEXUS_CIRCUIT_REJECTED_TOTAL.labels(provider=prov).inc()
    except Exception as exc:
        log.debug("record_circuit_rejected metric error: %s", exc)


def update_circuit_state_metric(provider: str = "generic", state: str = "CLOSED") -> None:
    try:
        prov = _sanitize(provider, ALLOWED_PROVIDERS, "generic")
        val = 0.0
        s_upper = str(state).upper()
        if s_upper == "OPEN":
            val = 2.0
        elif s_upper == "HALF_OPEN":
            val = 1.0
        NEXUS_CIRCUIT_STATE.labels(provider=prov).set(val)
    except Exception as exc:
        log.debug("update_circuit_state_metric error: %s", exc)


# ── Phase 6 P2.3: Dynamic Worker Scaling & Resource Admission Helpers ───────

def record_resource_admission_rejected(reason: str = "unknown") -> None:
    try:
        rsn = _sanitize(reason, ALLOWED_RESOURCE_REASONS, "unknown")
        NEXUS_RESOURCE_REJECTION_TOTAL.labels(reason=rsn).inc()
    except Exception as exc:
        log.debug("record_resource_admission_rejected error: %s", exc)


def record_resource_admission_deferred(reason: str = "unknown") -> None:
    try:
        rsn = _sanitize(reason, ALLOWED_RESOURCE_REASONS, "unknown")
        NEXUS_RESOURCE_DEFER_TOTAL.labels(reason=rsn).inc()
    except Exception as exc:
        log.debug("record_resource_admission_deferred error: %s", exc)


def record_worker_scale_event(direction: str = "up") -> None:
    try:
        dir_val = _sanitize(direction, ALLOWED_SCALE_DIRECTIONS, "unknown")
        NEXUS_WORKER_SCALE_EVENTS_TOTAL.labels(direction=dir_val).inc()
    except Exception as exc:
        log.debug("record_worker_scale_event error: %s", exc)


def set_worker_autoscaling_gauges(desired: int, active: int) -> None:
    try:
        NEXUS_WORKER_DESIRED.set(float(max(0, desired)))
        NEXUS_WORKER_ACTIVE.set(float(max(0, active)))
    except Exception as exc:
        log.debug("set_worker_autoscaling_gauges error: %s", exc)


def set_host_resource_gauges(cpu_percent: float, available_memory_bytes: int) -> None:
    try:
        ratio = max(0.0, min(1.0, float(cpu_percent) / 100.0))
        NEXUS_HOST_CPU_UTILIZATION_RATIO.set(ratio)
        NEXUS_HOST_MEMORY_AVAILABLE_BYTES.set(float(max(0, available_memory_bytes)))
    except Exception as exc:
        log.debug("set_host_resource_gauges error: %s", exc)



# ─── Dynamic Gauge Collection ────────────────────────────────────────────────

async def collect_dynamic_gauges() -> None:
    """Collect real-time gauge metrics from Redis, DB, and process registries."""
    if not is_metrics_enabled():
        return

    # 1. Active FFmpeg Subprocesses
    try:
        from backend.download_handler import ACTIVE_PROCESSES
        NEXUS_FFMPEG_RUNNING.set(float(len(ACTIVE_PROCESSES)))
    except Exception as exc:
        log.debug("Error updating ffmpeg gauge: %s", exc)

    # 2. Active Jobs Running
    try:
        from backend.job_store import JOB_RUNTIME_STATE
        active_count = sum(
            1 for state in JOB_RUNTIME_STATE.values()
            if str(state.get("status") or "").lower() in {"queued", "downloading", "processing", "extracting"}
        )
        NEXUS_JOBS_RUNNING.set(float(active_count))
    except Exception as exc:
        log.debug("Error updating active jobs gauge: %s", exc)

    # 3. Queue Depths via Redis
    try:
        from backend.api_v1.middleware import _get_redis_client
        redis_client = await _get_redis_client()
        if redis_client:
            for q_name in ("free_consumer", "priority_consumer", "render", "meta", "celery"):
                sanitized_q = _sanitize(q_name, ALLOWED_QUEUES, "default")
                try:
                    depth = await redis_client.llen(q_name)
                    NEXUS_QUEUE_DEPTH.labels(queue_name=sanitized_q).set(float(depth))
                except Exception:
                    pass
    except Exception as exc:
        log.debug("Error updating queue depth gauges: %s", exc)

    # 4. Outbox Pending / Failed Counts via Supabase
    try:
        from backend.job_outbox import _get_supabase
        supabase = _get_supabase()
        if supabase:
            res_pending = await asyncio.to_thread(
                lambda: supabase.table("jobs")
                    .select("id", count="exact")
                    .eq("outbox_status", "pending")
                    .execute()
            )
            count_pending = res_pending.count if hasattr(res_pending, "count") and res_pending.count is not None else len(res_pending.data or [])
            NEXUS_OUTBOX_PENDING.set(float(count_pending))

            res_failed = await asyncio.to_thread(
                lambda: supabase.table("jobs")
                    .select("id", count="exact")
                    .eq("outbox_status", "pending")
                    .gte("outbox_attempt_count", 5)
                    .execute()
            )
            count_failed = res_failed.count if hasattr(res_failed, "count") and res_failed.count is not None else len(res_failed.data or [])
            NEXUS_OUTBOX_FAILED.set(float(count_failed))
    except Exception as exc:
        log.debug("Error updating outbox gauges: %s", exc)

    # 5. Host Resource Pressure (CPU & RAM)
    try:
        from backend.admission_control import get_system_resource_snapshot
        snapshot = get_system_resource_snapshot()
        if snapshot.healthy:
            set_host_resource_gauges(
                snapshot.cpu_percent,
                int(snapshot.available_memory_mb * 1024 * 1024),
            )
    except Exception as exc:
        log.debug("Error updating host resource gauges: %s", exc)


async def generate_metrics_payload() -> tuple[bytes, str]:
    """Gather current metrics and return (bytes_payload, content_type)."""
    if not is_metrics_enabled():
        return b"# NEXUS metrics exporter is disabled (set NEXUS_METRICS_ENABLED=true)\n", "text/plain; charset=utf-8"

    await collect_dynamic_gauges()
    content = generate_latest(REGISTRY)
    return content, CONTENT_TYPE_LATEST
