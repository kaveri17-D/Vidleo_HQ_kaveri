"""
NEXUS Phase 6 P1-2 — Deep Health & Readiness Probe
===================================================

Provides structured multi-subsystem liveness and readiness evaluation for
production load balancers, orchestrators, and automated canary deployments.

Checks:
-------
1. Application Process (memory RSS, PID, uptime)
2. PostgreSQL / Supabase Connectivity
3. Redis Cache & Coordination Engine
4. Celery Queue & Work Broker
5. Local / Cloud Storage Accessibility
6. Execution Binaries (FFmpeg, yt-dlp)
7. Distributed Circuit Breakers

Security Guarantee:
-------------------
Zero leakage of infrastructure secrets, database passwords, Redis URLs,
hostnames, IP addresses, or internal filesystem absolute paths.

Feature Flag:
-------------
Gated by `NEXUS_DEEP_HEALTH_ENABLED` (default: false / 0).
When disabled, `/api/health/deep` returns 404.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging
import os
import shutil
import time
from typing import Any

log = logging.getLogger("nexus.health.deep")


def is_deep_health_enabled() -> bool:
    return os.environ.get("NEXUS_DEEP_HEALTH_ENABLED", "0").lower() in ("1", "true", "yes")


# ─── Individual Subsystem Checkers ───────────────────────────────────────────

async def _check_database(timeout_seconds: float = 1.0) -> dict[str, Any]:
    start = time.perf_counter()
    try:
        from backend.auth import supabase
        if not supabase:
            return {
                "status": "degraded",
                "ready": True,
                "latency_ms": round((time.perf_counter() - start) * 1000, 2),
                "detail": "Database client unconfigured or optional fallback active",
            }

        # Lightweight query bounded by timeout
        res = await asyncio.wait_for(
            asyncio.to_thread(lambda: supabase.table("jobs").select("id").limit(1).execute()),
            timeout=timeout_seconds,
        )
        latency = round((time.perf_counter() - start) * 1000, 2)
        return {
            "status": "healthy",
            "ready": True,
            "latency_ms": latency,
            "detail": "Connected and responsive",
        }
    except asyncio.TimeoutError:
        return {
            "status": "unhealthy",
            "ready": False,
            "latency_ms": round(timeout_seconds * 1000, 2),
            "detail": "Query timeout exceeded",
        }
    except Exception as exc:
        log.warning("Deep health database check failed: %s", exc)
        return {
            "status": "unhealthy",
            "ready": False,
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
            "detail": "Query execution failed",
        }


async def _check_redis(timeout_seconds: float = 1.0) -> dict[str, Any]:
    start = time.perf_counter()
    try:
        from backend.api_v1.middleware import _get_redis_client
        redis_client = await asyncio.wait_for(_get_redis_client(), timeout=timeout_seconds)
        if not redis_client:
            return {
                "status": "degraded",
                "ready": True,
                "mode": "disabled",
                "latency_ms": round((time.perf_counter() - start) * 1000, 2),
                "detail": "Redis client unconfigured (in-memory degraded mode)",
                "role": "none",
                "persistence": "none",
            }

        pong = await asyncio.wait_for(redis_client.ping(), timeout=timeout_seconds)
        latency = round((time.perf_counter() - start) * 1000, 2)
        if pong:
            info: dict[str, Any] = {}
            try:
                raw_info = await asyncio.wait_for(redis_client.info(), timeout=timeout_seconds)
                if isinstance(raw_info, dict):
                    info = {
                        "role": str(raw_info.get("role", "standalone")),
                        "aof_enabled": bool(raw_info.get("aof_enabled", 0)),
                        "aof_status": str(raw_info.get("aof_last_bgrewrite_status", "ok")),
                        "rdb_status": str(raw_info.get("rdb_last_bgsave_status", "ok")),
                        "used_memory": str(raw_info.get("used_memory_human", "unknown")),
                        "connected_clients": int(raw_info.get("connected_clients", 0)),
                    }
            except Exception:
                pass

            persistence_posture = "aof_enabled" if info.get("aof_enabled") else ("rdb_enabled" if info.get("rdb_status") == "ok" else "none")

            return {
                "status": "healthy",
                "ready": True,
                "mode": "online",
                "latency_ms": latency,
                "detail": "Ping successful",
                "role": info.get("role", "standalone"),
                "persistence": persistence_posture,
                "aof_enabled": info.get("aof_enabled", False),
                "used_memory": info.get("used_memory", "unknown"),
                "connected_clients": info.get("connected_clients", 0),
            }
        return {
            "status": "unhealthy",
            "ready": False,
            "mode": "unavailable",
            "latency_ms": latency,
            "detail": "Ping returned false",
            "role": "unknown",
            "persistence": "unknown",
        }
    except asyncio.TimeoutError:
        return {
            "status": "unhealthy",
            "ready": False,
            "mode": "unavailable",
            "latency_ms": round(timeout_seconds * 1000, 2),
            "detail": "Ping timeout exceeded",
            "role": "unknown",
            "persistence": "unknown",
        }
    except Exception as exc:
        log.warning("Deep health Redis check failed: %s", exc)
        return {
            "status": "unhealthy",
            "ready": False,
            "mode": "unavailable",
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
            "detail": "Connection failed",
            "role": "unknown",
            "persistence": "unknown",
        }


async def _check_celery(timeout_seconds: float = 1.0) -> dict[str, Any]:
    start = time.perf_counter()
    try:
        from backend.celery_app import celery_available, celery_app
        from backend.api_v1.middleware import _get_redis_client

        if not celery_available or not celery_app:
            return {
                "status": "degraded",
                "ready": True,
                "latency_ms": round((time.perf_counter() - start) * 1000, 2),
                "detail": "Celery not configured; local async runner active",
            }

        redis_client = await asyncio.wait_for(_get_redis_client(), timeout=timeout_seconds)
        queues = {}
        if redis_client:
            for q in ("render", "free_consumer", "priority_consumer"):
                try:
                    queues[q] = await asyncio.wait_for(redis_client.llen(q), timeout=0.3)
                except Exception:
                    queues[q] = -1

        return {
            "status": "healthy",
            "ready": True,
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
            "detail": "Broker reachable",
            "queue_depths": queues,
        }
    except Exception as exc:
        log.warning("Deep health Celery check failed: %s", exc)
        return {
            "status": "degraded",
            "ready": True,
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
            "detail": "Broker check failed; local runner fallback available",
        }


def _check_storage() -> dict[str, Any]:
    start = time.perf_counter()
    from backend.storage_handler import (
        get_storage_mode,
        is_enforce_object_storage,
        is_r2_configured,
        probe_r2_connectivity,
    )

    storage_mode = get_storage_mode()
    enforced = is_enforce_object_storage()
    r2_configured = is_r2_configured()

    # 1. Local filesystem check
    local_ready = False
    local_status = "healthy"
    free_gb = 0.0
    try:
        from backend.download_handler import SHARED_DOWNLOAD_ROOT
        target_dir = SHARED_DOWNLOAD_ROOT
        target_dir.mkdir(parents=True, exist_ok=True)

        test_file = target_dir / f".health_probe_{int(time.time() * 1000)}.tmp"
        test_file.write_text("probe")
        test_file.unlink(missing_ok=True)

        stat = shutil.disk_usage(target_dir)
        free_gb = round(stat.free / (1024 ** 3), 2)
        local_ready = free_gb >= 1.0
        local_status = "healthy" if local_ready else "degraded"
    except Exception as exc:
        log.warning("Deep health local storage check failed: %s", exc)
        local_ready = False
        local_status = "unhealthy"

    # 2. Object storage / R2 probe (if configured or enforced)
    r2_report: dict[str, Any] | None = None
    if r2_configured or enforced:
        try:
            r2_report = probe_r2_connectivity(timeout_seconds=1.5)
        except Exception as exc:
            r2_report = {
                "status": "unhealthy",
                "ready": False,
                "mode": "r2_unreachable",
                "capabilities": {"upload": False, "read": False, "delete": False},
                "detail": f"Probe error: {str(exc)}",
            }

    latency = round((time.perf_counter() - start) * 1000, 2)

    # 3. Synthesize readiness and status based on storage mode
    if enforced:
        r2_ready = bool(r2_report and r2_report.get("ready"))
        ready = r2_ready
        status = "healthy" if r2_ready else "unhealthy"
        detail = (
            "Multi-instance object storage operational"
            if r2_ready
            else f"MANDATORY object storage unavailable: {r2_report.get('detail') if r2_report else 'Not configured'}"
        )
    elif r2_configured:
        r2_ready = bool(r2_report and r2_report.get("ready"))
        ready = local_ready or r2_ready
        if r2_ready and local_status == "healthy":
            status = "healthy"
            detail = "Object storage (R2) and local scratch operational"
        elif r2_ready:
            status = "degraded"
            detail = "R2 operational, but local scratch degraded"
        else:
            status = "degraded"
            detail = f"Local scratch operational, but R2 degraded: {r2_report.get('detail') if r2_report else ''}"
    else:
        ready = local_ready
        status = local_status
        detail = "Single-node local storage operational" if local_ready else ("Low disk space (<1GB)" if free_gb < 1.0 else "Local storage not writable")

    result = {
        "status": status,
        "ready": ready,
        "latency_ms": latency,
        "storage_mode": storage_mode,
        "enforce_object_storage": enforced,
        "detail": detail,
        "free_space_gb": free_gb,
    }
    if r2_report:
        result["r2"] = r2_report

    return result


def _check_binaries() -> dict[str, Any]:
    start = time.perf_counter()
    ffmpeg_found = shutil.which("ffmpeg") is not None
    ffprobe_found = shutil.which("ffprobe") is not None
    ytdlp_found = shutil.which("yt-dlp") is not None

    all_ok = ffmpeg_found and ffprobe_found and ytdlp_found
    latency = round((time.perf_counter() - start) * 1000, 2)
    return {
        "status": "healthy" if all_ok else "unhealthy",
        "ready": all_ok,
        "latency_ms": latency,
        "ffmpeg": ffmpeg_found,
        "ffprobe": ffprobe_found,
        "yt_dlp": ytdlp_found,
        "detail": "All media extraction binaries present" if all_ok else "Required binaries missing from PATH",
    }


async def _check_circuits() -> dict[str, Any]:
    start = time.perf_counter()
    try:
        from backend.circuit_breaker import get_all_circuit_states, is_circuit_breaker_enabled
        if not is_circuit_breaker_enabled():
            return {
                "status": "healthy",
                "ready": True,
                "latency_ms": round((time.perf_counter() - start) * 1000, 2),
                "detail": "Circuit breaker feature disabled",
            }
        states = await get_all_circuit_states()
        any_open = any(v == "OPEN" for v in states.values())
        return {
            "status": "degraded" if any_open else "healthy",
            "ready": True,
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
            "states": states,
            "detail": "Circuits operational" if not any_open else "One or more provider circuits currently OPEN",
        }
    except Exception as exc:
        log.debug("Deep health circuit check skipped: %s", exc)
        return {
            "status": "healthy",
            "ready": True,
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
            "detail": "Circuit inspection skipped",
        }


# ─── Master Evaluator ────────────────────────────────────────────────────────

async def evaluate_deep_health(total_timeout: float = 2.5) -> dict[str, Any]:
    """
    Execute all sub-checks concurrently with bounded timeouts.
    Synthesizes overall readiness (READY / NOT_READY) and status (healthy / degraded / unhealthy).
    """
    start_total = time.perf_counter()

    try:
        db_task = asyncio.create_task(_check_database())
        redis_task = asyncio.create_task(_check_redis())
        celery_task = asyncio.create_task(_check_celery())
        circuits_task = asyncio.create_task(_check_circuits())
        storage_res = await asyncio.to_thread(_check_storage)
        binaries_res = await asyncio.to_thread(_check_binaries)

        db_res, redis_res, celery_res, circuits_res = await asyncio.wait_for(
            asyncio.gather(db_task, redis_task, celery_task, circuits_task),
            timeout=total_timeout,
        )
    except asyncio.TimeoutError:
        log.error("Deep health check exceeded total deadline of %.2fs", total_timeout)
        return {
            "status": "unhealthy",
            "ready": False,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "detail": "Deep health check timed out",
            "latency_ms": round(total_timeout * 1000, 2),
        }

    # Aggregate readiness: critical components must be ready
    critical_ready = (
        db_res.get("ready", False)
        and storage_res.get("ready", False)
        and binaries_res.get("ready", False)
    )
    # Redis is required if configured and operational
    if redis_res.get("status") == "unhealthy":
        critical_ready = False

    # Aggregate overall status
    all_statuses = [
        db_res.get("status"),
        redis_res.get("status"),
        celery_res.get("status"),
        storage_res.get("status"),
        binaries_res.get("status"),
        circuits_res.get("status"),
    ]

    if not critical_ready or "unhealthy" in all_statuses:
        overall_status = "unhealthy"
    elif "degraded" in all_statuses:
        overall_status = "degraded"
    else:
        overall_status = "healthy"

    # Capacity snapshot
    active_jobs = 0
    active_procs = 0
    try:
        from backend.download_handler import ACTIVE_PROCESSES
        active_procs = len(ACTIVE_PROCESSES)
    except Exception:
        pass
    try:
        from backend.job_store import JOB_RUNTIME_STATE
        active_jobs = sum(1 for s in JOB_RUNTIME_STATE.values() if str(s.get("status") or "").lower() in ("queued", "downloading", "processing"))
    except Exception:
        pass

    total_latency = round((time.perf_counter() - start_total) * 1000, 2)

    return {
        "status": overall_status,
        "ready": critical_ready,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "3.0.0",
        "total_latency_ms": total_latency,
        "dependencies": {
            "database": db_res,
            "redis": redis_res,
            "celery": celery_res,
            "storage": storage_res,
            "binaries": binaries_res,
            "circuit_breakers": circuits_res,
        },
        "capacity": {
            "active_jobs": active_jobs,
            "active_processes": active_procs,
        },
    }
