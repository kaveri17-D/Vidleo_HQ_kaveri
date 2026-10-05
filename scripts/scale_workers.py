"""
NEXUS Phase 6 P2.3 — Dynamic Worker Autoscaler
==============================================

Automated, queue-driven, and resource-aware worker scaling controller.
Implements the core scaling policy decoupled from the deployment execution adapter.

Architectural Separation:
-------------------------
Scaling Policy
    ↓
Desired Worker Count
    ↓
Deployment Adapter (Docker Compose or Process Manager)
    ↓
Actual Worker Reconciliation & Draining
"""
from __future__ import annotations

from abc import ABC, abstractmethod
import asyncio
from dataclasses import dataclass
import json
import logging
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from typing import Any

# Ensure project root in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

log = logging.getLogger("nexus.autoscaler")

# ─── Configuration & Defaults ────────────────────────────────────────────────
def _get_env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, str(default)))
    except (ValueError, TypeError):
        return default

def _get_env_float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, str(default)))
    except (ValueError, TypeError):
        return default


MIN_RENDER_WORKERS = _get_env_int("NEXUS_MIN_RENDER_WORKERS", 1)
MAX_RENDER_WORKERS = _get_env_int("NEXUS_MAX_RENDER_WORKERS", 8)
WORKER_CONCURRENCY_SLOTS = _get_env_int("CELERY_WORKER_CONCURRENCY", 4)

SCALE_UP_QUEUE_DEPTH = _get_env_int("NEXUS_AUTOSCALE_UP_QUEUE_DEPTH", 5)
SCALE_UP_OLDEST_AGE_SECONDS = _get_env_float("NEXUS_AUTOSCALE_UP_OLD_JOB_AGE", 45.0)

SCALE_DOWN_EMPTY_SECONDS = _get_env_float("NEXUS_AUTOSCALE_DOWN_STABILIZATION_SECONDS", 300.0)

SCALE_UP_COOLDOWN_SECONDS = _get_env_float("NEXUS_AUTOSCALE_UP_COOLDOWN_SECONDS", 120.0)
SCALE_DOWN_COOLDOWN_SECONDS = _get_env_float("NEXUS_AUTOSCALE_DOWN_COOLDOWN_SECONDS", 300.0)
MAX_SCALE_UP_STEP = _get_env_int("NEXUS_AUTOSCALE_MAX_STEP", 2)
AUTOSCALE_MAX_CPU_PERCENT = _get_env_float("NEXUS_AUTOSCALE_MAX_CPU_PERCENT", 95.0)
AUTOSCALE_MIN_FREE_RAM_MB = _get_env_float("NEXUS_AUTOSCALE_MIN_FREE_RAM_MB", 500.0)


# ─── Operational Metrics Data ────────────────────────────────────────────────

@dataclass
class AutoscalingSignals:
    queue_depth: int
    oldest_job_age_seconds: float
    active_jobs: int
    current_workers: int
    cpu_percent: float
    available_memory_mb: float
    timestamp: float = 0.0

    def __post_init__(self):
        if self.timestamp == 0.0:
            self.timestamp = time.time()


# ─── Scaling Policy Engine (Pure Logic) ──────────────────────────────────────

class ScalingPolicy:
    """
    Decoupled scaling decision engine. Evaluates operational signals and
    calculates target worker count without direct execution side-effects.
    """
    def __init__(
        self,
        min_workers: int = MIN_RENDER_WORKERS,
        max_workers: int = MAX_RENDER_WORKERS,
        worker_slots: int = WORKER_CONCURRENCY_SLOTS,
        scale_up_queue_depth: int = SCALE_UP_QUEUE_DEPTH,
        scale_up_oldest_age_sec: float = SCALE_UP_OLDEST_AGE_SECONDS,
        scale_down_empty_sec: float = SCALE_DOWN_EMPTY_SECONDS,
        scale_up_cooldown_sec: float = SCALE_UP_COOLDOWN_SECONDS,
        scale_down_cooldown_sec: float = SCALE_DOWN_COOLDOWN_SECONDS,
        max_scale_step: int = MAX_SCALE_UP_STEP,
        max_cpu_percent: float | None = AUTOSCALE_MAX_CPU_PERCENT,
        min_ram_mb: float | None = AUTOSCALE_MIN_FREE_RAM_MB,
    ):
        self.min_workers = max(1, min_workers)
        self.max_workers = max(self.min_workers, max_workers)
        self.worker_slots = max(1, worker_slots)
        self.scale_up_queue_depth = scale_up_queue_depth
        self.scale_up_oldest_age_sec = scale_up_oldest_age_sec
        self.scale_down_empty_sec = scale_down_empty_sec
        self.scale_up_cooldown_sec = scale_up_cooldown_sec
        self.scale_down_cooldown_sec = scale_down_cooldown_sec
        self.max_scale_step = max_scale_step
        self.max_cpu_percent = max_cpu_percent
        self.min_ram_mb = min_ram_mb

        self.last_scale_up_time: float = 0.0
        self.last_scale_down_time: float = 0.0
        self.queue_empty_since: float | None = None

    def evaluate_desired_workers(self, signals: AutoscalingSignals) -> tuple[int, str]:
        now = signals.timestamp
        current = signals.current_workers

        # Track queue empty duration
        if signals.queue_depth == 0:
            if self.queue_empty_since is None:
                self.queue_empty_since = now
        else:
            self.queue_empty_since = None

        # 1. Capacity Hard Guardrails
        if current < self.min_workers:
            return self.min_workers, f"below_min_capacity ({current} < {self.min_workers})"
        if current > self.max_workers:
            return self.max_workers, f"above_max_capacity ({current} > {self.max_workers})"

        # 2. Check Scale-Up Triggers
        scale_up_needed = (
            signals.queue_depth >= self.scale_up_queue_depth
            or signals.oldest_job_age_seconds >= self.scale_up_oldest_age_sec
        )

        if scale_up_needed:
            # Check host resource saturation before scaling up
            # (Do not scale up if host is already heavily saturated)
            if self.max_cpu_percent is not None and signals.cpu_percent >= self.max_cpu_percent:
                return current, f"scale_up_suppressed_cpu_saturation ({signals.cpu_percent:.1f}%)"
            if self.min_ram_mb is not None and signals.available_memory_mb > 0 and signals.available_memory_mb < self.min_ram_mb:
                return current, f"scale_up_suppressed_memory_exhaustion ({signals.available_memory_mb:.0f}MB)"

            # Check cooldown
            elapsed_since_up = now - self.last_scale_up_time
            if elapsed_since_up < self.scale_up_cooldown_sec:
                return current, f"scale_up_cooldown ({elapsed_since_up:.0f}s < {self.scale_up_cooldown_sec:.0f}s)"

            # Calculate additional workers required
            backlog = signals.queue_depth + signals.active_jobs
            slots_needed = max(1, backlog)
            target = int(math.ceil(slots_needed / float(self.worker_slots)))
            target = max(current + 1, target)
            target = min(target, current + self.max_scale_step)
            target = min(self.max_workers, target)

            if target > current:
                return target, f"scale_up_triggered (queue={signals.queue_depth}, oldest_age={signals.oldest_job_age_seconds:.1f}s)"

        # 3. Check Scale-Down Triggers
        if current > self.min_workers:
            if self.queue_empty_since is not None:
                empty_duration = now - self.queue_empty_since
                if empty_duration >= self.scale_down_empty_sec:
                    elapsed_since_down = now - self.last_scale_down_time
                    if elapsed_since_down >= self.scale_down_cooldown_sec:
                        target = max(self.min_workers, current - 1)
                        return target, f"scale_down_triggered (queue_empty_for={empty_duration:.0f}s)"
                    else:
                        return current, f"scale_down_cooldown ({elapsed_since_down:.0f}s < {self.scale_down_cooldown_sec:.0f}s)"
                else:
                    return current, f"scale_down_stabilizing ({empty_duration:.0f}s / {self.scale_down_empty_sec:.0f}s)"

        return current, "steady_state"

    def record_scale_event(self, from_count: int, to_count: int, now: float | None = None) -> None:
        t = now or time.time()
        if to_count > from_count:
            self.last_scale_up_time = t
        elif to_count < from_count:
            self.last_scale_down_time = t


# ─── Deployment Adapters ─────────────────────────────────────────────────────

class DeploymentAdapter(ABC):
    """Abstract interface for executing real worker scaling changes."""

    @abstractmethod
    def get_active_worker_count(self) -> int:
        """Query actual number of active worker processes/containers."""
        pass

    @abstractmethod
    def scale_workers(self, target_count: int) -> bool:
        """Scale worker pool up or down to target_count."""
        pass

    @abstractmethod
    def drain_and_scale_down(self, target_count: int, drain_timeout: float = 30.0) -> bool:
        """Gracefully drain excess workers and reduce capacity to target_count."""
        pass


class ProcessWorkerAdapter(DeploymentAdapter):
    """
    Process-based deployment adapter.
    Spawns and manages real local worker processes (Celery or background workers).
    Provides reliable, real process scaling for local, CI, and test environments.
    """
    def __init__(
        self,
        worker_cmd: list[str] | None = None,
        env: dict[str, str] | None = None,
        cwd: str | Path | None = None,
    ):
        self._lock = threading.Lock()
        self._workers: dict[int, subprocess.Popen] = {}
        self._worker_cmd = worker_cmd or [
            sys.executable,
            "-m",
            "celery",
            "-A",
            "backend.celery_app",
            "worker",
            "--loglevel=info",
            "-Q",
            "render",
        ]
        self._env = env or os.environ.copy()
        self._cwd = str(cwd or PROJECT_ROOT)

    def _purge_dead_workers(self) -> None:
        with self._lock:
            dead_pids = [pid for pid, proc in self._workers.items() if proc.poll() is not None]
            for pid in dead_pids:
                del self._workers[pid]

    def get_active_worker_count(self) -> int:
        self._purge_dead_workers()
        with self._lock:
            return len(self._workers)

    def scale_workers(self, target_count: int) -> bool:
        current = self.get_active_worker_count()
        if target_count == current:
            return True
        if target_count > current:
            needed = target_count - current
            for _ in range(needed):
                try:
                    proc = subprocess.Popen(
                        self._worker_cmd,
                        env=self._env,
                        cwd=self._cwd,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    with self._lock:
                        self._workers[proc.pid] = proc
                except Exception as exc:
                    log.error("Failed to spawn worker process: %s", exc)
                    return False
            return True
        else:
            return self.drain_and_scale_down(target_count)

    def drain_and_scale_down(self, target_count: int, drain_timeout: float = 30.0) -> bool:
        """
        Graceful scale-down:
        Sends SIGTERM to excess workers, allowing running jobs to finish.
        Only escalates to SIGKILL if drain_timeout expires.
        """
        self._purge_dead_workers()
        with self._lock:
            excess_count = len(self._workers) - target_count
            if excess_count <= 0:
                return True

            # Pick oldest workers to stop
            pids_to_drain = list(self._workers.keys())[:excess_count]
            draining_procs = [self._workers.pop(pid) for pid in pids_to_drain]

        # Send SIGTERM for graceful drain
        for p in draining_procs:
            try:
                p.send_signal(signal.SIGTERM)
            except Exception:
                pass

        # Wait for graceful drain
        start = time.time()
        for p in draining_procs:
            remaining = max(0.1, drain_timeout - (time.time() - start))
            try:
                p.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                log.warning("Worker pid %d exceeded drain timeout %ss; force killing", p.pid, drain_timeout)
                try:
                    p.kill()
                    p.wait(timeout=2.0)
                except Exception:
                    pass

        return True

    def terminate_all(self) -> None:
        with self._lock:
            for p in list(self._workers.values()):
                try:
                    p.terminate()
                    p.wait(timeout=2.0)
                except Exception:
                    try:
                        p.kill()
                    except Exception:
                        pass
            self._workers.clear()


class DockerComposeAdapter(DeploymentAdapter):
    """
    Docker Compose deployment adapter.
    Executes actual container scaling via `docker compose up -d --scale download_worker=N`.
    """
    def __init__(
        self,
        service_name: str = "download_worker",
        compose_file: str | Path | None = None,
        cwd: str | Path | None = None,
    ):
        self.service_name = service_name
        self.compose_file = str(compose_file or (PROJECT_ROOT / "backend" / "docker-compose.yml"))
        self.cwd = str(cwd or (PROJECT_ROOT / "backend"))

    def _run_compose_cmd(self, args: list[str], timeout: float = 30.0) -> subprocess.CompletedProcess:
        cmd = ["docker", "compose", "-f", self.compose_file] + args
        return subprocess.run(
            cmd,
            cwd=self.cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def get_active_worker_count(self) -> int:
        try:
            res = self._run_compose_cmd(["ps", "--filter", f"status=running", "--format", "json"], timeout=10.0)
            if res.returncode != 0:
                log.warning("docker compose ps failed: %s", res.stderr)
                return 1
            lines = res.stdout.strip().splitlines()
            count = 0
            for line in lines:
                try:
                    data = json.loads(line)
                    service = data.get("Service") or data.get("service")
                    if service == self.service_name:
                        count += 1
                except Exception:
                    if self.service_name in line:
                        count += 1
            return max(1, count)
        except Exception as exc:
            log.warning("Failed to query docker compose worker count (%s); assuming 1", exc)
            return 1

    def scale_workers(self, target_count: int) -> bool:
        try:
            scale_arg = f"{self.service_name}={target_count}"
            res = self._run_compose_cmd(["up", "-d", "--scale", scale_arg, "--no-recreate"], timeout=45.0)
            if res.returncode == 0:
                log.info("Scaled %s to %d containers successfully.", self.service_name, target_count)
                return True
            log.error("docker compose scale failed: %s", res.stderr)
            return False
        except Exception as exc:
            log.error("Exception during docker compose scale: %s", exc)
            return False

    def drain_and_scale_down(self, target_count: int, drain_timeout: float = 30.0) -> bool:
        # Docker Compose applies stop_grace_period from compose file on scale-down
        return self.scale_workers(target_count)


# ─── Operational Metrics Collector ──────────────────────────────────────────

async def collect_operational_signals(
    redis_client: Any = None,
    queue_name: str = "render",
    active_workers: int = 1,
) -> AutoscalingSignals:
    """Collect real queue, active jobs, and host metrics."""
    q_depth = 0
    oldest_age = 0.0

    if redis_client is not None:
        try:
            # 1. Queue depth
            q_depth = await redis_client.llen(queue_name)
            # 2. Oldest job age in queue
            if q_depth > 0:
                # Inspect oldest item in list (head/tail)
                first_item = await redis_client.lindex(queue_name, -1)
                if first_item:
                    try:
                        raw = json.loads(first_item)
                        # Celery or custom payload timestamp
                        enqueued_at = (
                            raw.get("headers", {}).get("enqueued_at")
                            or raw.get("enqueued_at")
                            or raw.get("timestamp")
                        )
                        if enqueued_at:
                            oldest_age = max(0.0, time.time() - float(enqueued_at))
                    except Exception:
                        pass
        except Exception as exc:
            log.debug("Redis queue metric collection error: %s", exc)

    # 3. Active jobs
    active_jobs = 0
    try:
        from backend.admission_control import REDIS_GLOBAL_ACTIVE_KEY
        if redis_client is not None:
            active_jobs = await redis_client.zcard(REDIS_GLOBAL_ACTIVE_KEY)
    except Exception:
        pass

    # 4. Host resources
    cpu_percent = 0.0
    avail_ram_mb = 0.0
    try:
        from backend.admission_control import get_system_resource_snapshot
        snapshot = get_system_resource_snapshot()
        cpu_percent = snapshot.cpu_percent
        avail_ram_mb = snapshot.available_memory_mb
    except Exception:
        pass

    return AutoscalingSignals(
        queue_depth=q_depth,
        oldest_job_age_seconds=oldest_age,
        active_jobs=active_jobs,
        current_workers=active_workers,
        cpu_percent=cpu_percent,
        available_memory_mb=avail_ram_mb,
    )


# ─── Full Autoscaling Controller ─────────────────────────────────────────────

class AutoscalingController:
    """
    Main autoscaling controller orchestrating:
      Signals Collection -> Policy Evaluation -> Adapter Reconciliation -> Telemetry
    """
    def __init__(
        self,
        adapter: DeploymentAdapter,
        policy: ScalingPolicy | None = None,
        queue_name: str = "render",
        redis_client: Any = None,
    ):
        self.adapter = adapter
        self.policy = policy or ScalingPolicy()
        self.queue_name = queue_name
        self.redis_client = redis_client

    async def reconcile_once(self) -> dict[str, Any]:
        """Perform one complete evaluation and reconciliation cycle."""
        current_workers = self.adapter.get_active_worker_count()
        signals = await collect_operational_signals(
            redis_client=self.redis_client,
            queue_name=self.queue_name,
            active_workers=current_workers,
        )

        desired_workers, reason = self.policy.evaluate_desired_workers(signals)
        action_taken = "none"

        # Update telemetry
        try:
            from backend.metrics import set_worker_autoscaling_gauges
            set_worker_autoscaling_gauges(desired=desired_workers, active=current_workers)
        except Exception:
            pass

        if desired_workers != current_workers:
            if desired_workers > current_workers:
                action_taken = "scale_up"
                success = self.adapter.scale_workers(desired_workers)
                if success:
                    self.policy.record_scale_event(current_workers, desired_workers, signals.timestamp)
                    try:
                        from backend.metrics import record_worker_scale_event
                        record_worker_scale_event("up")
                    except Exception:
                        pass
            else:
                action_taken = "scale_down"
                success = self.adapter.drain_and_scale_down(desired_workers)
                if success:
                    self.policy.record_scale_event(current_workers, desired_workers, signals.timestamp)
                    try:
                        from backend.metrics import record_worker_scale_event
                        record_worker_scale_event("down")
                    except Exception:
                        pass

        actual_after = self.adapter.get_active_worker_count()
        return {
            "current_workers": current_workers,
            "desired_workers": desired_workers,
            "actual_workers": actual_after,
            "action": action_taken,
            "reason": reason,
            "queue_depth": signals.queue_depth,
            "oldest_job_age": signals.oldest_job_age_seconds,
            "cpu_percent": signals.cpu_percent,
            "available_memory_mb": signals.available_memory_mb,
        }

    async def run_loop(self, poll_interval_sec: float = 5.0, stop_event: threading.Event | None = None) -> None:
        log.info(
            "Autoscaler controller loop starting (queue=%s, min=%d, max=%d, poll=%.1fs)",
            self.queue_name, self.policy.min_workers, self.policy.max_workers, poll_interval_sec,
        )
        while stop_event is None or not stop_event.is_set():
            try:
                res = await self.reconcile_once()
                if res["action"] != "none":
                    log.info(
                        "Autoscaler reconciled: %s (from %d to %d, actual=%d, reason=%s)",
                        res["action"], res["current_workers"], res["desired_workers"], res["actual_workers"], res["reason"],
                    )
            except Exception as exc:
                log.error("Autoscaler loop error: %s", exc)
            await asyncio.sleep(poll_interval_sec)


# ─── Standalone Script CLI Entrypoint ────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="NEXUS Worker Autoscaler")
    parser.add_argument("--mode", choices=["compose", "process"], default="compose", help="Deployment adapter mode")
    parser.add_argument("--queue", default="render", help="Target Redis queue to monitor")
    parser.add_argument("--interval", type=float, default=5.0, help="Reconciliation loop interval in seconds")
    parser.add_argument("--once", action="store_true", help="Execute single reconciliation step and exit")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s - %(message)s")

    adapter: DeploymentAdapter
    if args.mode == "compose":
        adapter = DockerComposeAdapter()
    else:
        adapter = ProcessWorkerAdapter()

    # Get redis client
    from backend.api_v1.middleware import _get_redis_client
    redis_client = asyncio.run(_get_redis_client())

    controller = AutoscalingController(adapter=adapter, queue_name=args.queue, redis_client=redis_client)

    if args.once:
        res = asyncio.run(controller.reconcile_once())
        print(json.dumps(res, indent=2))
    else:
        try:
            asyncio.run(controller.run_loop(poll_interval_sec=args.interval))
        except KeyboardInterrupt:
            print("\nAutoscaler shutting down...")


if __name__ == "__main__":
    main()
