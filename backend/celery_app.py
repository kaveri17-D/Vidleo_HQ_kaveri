from __future__ import annotations

import os

try:
    from celery import Celery
except Exception:  # pragma: no cover - graceful fallback when Celery is not installed yet
    Celery = None


REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
celery_available = Celery is not None

if celery_available:
    def _interval_seconds(env_name: str, default: int, minimum: int = 60) -> int:
        raw = os.environ.get(env_name, str(default))
        try:
            return max(minimum, int(raw))
        except (TypeError, ValueError):
            return max(minimum, default)


    celery_app = Celery(
        "nexus_media_engine",
        broker=REDIS_URL,
        backend=REDIS_URL,
        include=["backend.tasks"],
    )
    celery_app.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        task_default_queue="meta",
        task_routes={
            # 1. The Fast Lane (meta.*)
            "backend.workers.proxy_state.metadata_probe_task": {"queue": "meta"},
            "backend.workers.proxy_state.link_validation_task": {"queue": "meta"},
            "tasks.metadata_probe_task": {"queue": "meta"},

            # 2. The Heavy Muscle Lane (render.*)
            "tasks.download_delivery_task": {"queue": "render"},

            # 3. The Shipping Dock (syndicate.*)
            "backend.workers.syndication.webhook_dispatch_task": {"queue": "syndicate"},
            "backend.workers.syndication.execute_platform_upload_task": {"queue": "syndicate"},

            # 4. Maintenance / rollup tasks (maintenance_worker)
            "tasks.fallback_cleanup_task": {"queue": "maintenance_worker"},
            "tasks.history_rollup_task": {"queue": "maintenance_worker"},
            "tasks.revenue_rollup_task": {"queue": "maintenance_worker"},
            "tasks.audit_rollup_task": {"queue": "maintenance_worker"},
            "tasks.subscription_rollup_task": {"queue": "maintenance_worker"},
            "tasks.billing_reconciliation_task": {"queue": "maintenance_worker"},
            "tasks.abuse_rollup_task": {"queue": "maintenance_worker"},
            "tasks.proxy_rollup_task": {"queue": "maintenance_worker"},
            "tasks.proxy_alert_rollup_task": {"queue": "maintenance_worker"},
            "tasks.proxy_breaker_posture_rollup_task": {"queue": "maintenance_worker"},
            "tasks.proxy_alert_snapshot_task": {"queue": "maintenance_worker"},
            "tasks.proxy_auto_recovery_task": {"queue": "maintenance_worker"},
            "tasks.proxy_circuit_breaker_task": {"queue": "maintenance_worker"},
        },
        beat_schedule={
            "fallback-cleanup": {
                "task": "tasks.fallback_cleanup_task",
                "schedule": _interval_seconds("FALLBACK_CLEANUP_INTERVAL_SECONDS", 900, 60),
                "options": {"queue": "maintenance_worker"},
            },
            "history-rollups": {
                "task": "tasks.history_rollup_task",
                "schedule": _interval_seconds("VAULT_HISTORY_ROLLUP_INTERVAL_SECONDS", 1800, 300),
                "options": {"queue": "maintenance_worker"},
            },
            "revenue-rollups": {
                "task": "tasks.revenue_rollup_task",
                "schedule": _interval_seconds("REVENUE_ROLLUP_INTERVAL_SECONDS", 1800, 300),
                "options": {"queue": "maintenance_worker"},
            },
            "audit-rollups": {
                "task": "tasks.audit_rollup_task",
                "schedule": _interval_seconds("AUDIT_ROLLUP_INTERVAL_SECONDS", 1800, 300),
                "options": {"queue": "maintenance_worker"},
            },
            "subscription-rollups": {
                "task": "tasks.subscription_rollup_task",
                "schedule": _interval_seconds("SUBSCRIPTION_ROLLUP_INTERVAL_SECONDS", 1800, 300),
                "options": {"queue": "maintenance_worker"},
            },
            "billing-reconciliation": {
                "task": "tasks.billing_reconciliation_task",
                "schedule": _interval_seconds("BILLING_RECONCILIATION_INTERVAL_SECONDS", 1800, 300),
                "options": {"queue": "maintenance_worker"},
            },
            "abuse-rollups": {
                "task": "tasks.abuse_rollup_task",
                "schedule": _interval_seconds("ABUSE_ROLLUP_INTERVAL_SECONDS", 1800, 300),
                "options": {"queue": "maintenance_worker"},
            },
            "proxy-rollups": {
                "task": "tasks.proxy_rollup_task",
                "schedule": _interval_seconds("PROXY_ROLLUP_FLUSH_INTERVAL_SECONDS", 900, 300),
                "options": {"queue": "maintenance_worker"},
            },
            "proxy-alert-rollups": {
                "task": "tasks.proxy_alert_rollup_task",
                "schedule": _interval_seconds("PROXY_ALERT_ROLLUP_INTERVAL_SECONDS", 1800, 300),
                "options": {"queue": "maintenance_worker"},
            },
            "proxy-breaker-posture-rollups": {
                "task": "tasks.proxy_breaker_posture_rollup_task",
                "schedule": _interval_seconds("PROXY_BREAKER_POSTURE_ROLLUP_INTERVAL_SECONDS", 1800, 300),
                "options": {"queue": "maintenance_worker"},
            },
            "proxy-alert-snapshots": {
                "task": "tasks.proxy_alert_snapshot_task",
                "schedule": _interval_seconds("PROXY_ALERT_SNAPSHOT_INTERVAL_SECONDS", 1800, 300),
                "options": {"queue": "maintenance_worker"},
            },
            "proxy-auto-recovery": {
                "task": "tasks.proxy_auto_recovery_task",
                "schedule": _interval_seconds("PROXY_AUTO_RECOVERY_POLL_INTERVAL_SECONDS", 900, 60),
                "options": {"queue": "maintenance_worker"},
            },
            "proxy-circuit-breaker-watchdog": {
                "task": "tasks.proxy_circuit_breaker_task",
                "schedule": _interval_seconds("PROXY_CIRCUIT_BREAKER_WATCHDOG_SECONDS", 300, 60),
                "options": {"queue": "maintenance_worker"},
            },
            "ytdlp-nightly-update": {
                "task": "tasks.update_ytdlp_nightly_task",
                "schedule": _interval_seconds("YTDLP_NIGHTLY_UPDATE_INTERVAL_SECONDS", 600, 300),
                "options": {"queue": "maintenance_worker"},
            },
        },
        worker_prefetch_multiplier=1,
        task_acks_late=True,
        # ── Elite Concurrency Doctrine: Worker Hardening ──────────────────
        worker_concurrency=int(os.environ.get("CELERY_WORKER_CONCURRENCY", "4")),
        worker_max_tasks_per_child=int(os.environ.get("CELERY_MAX_TASKS_PER_CHILD", "50")),
        worker_max_memory_per_child=int(os.environ.get("CELERY_MAX_MEMORY_PER_CHILD_KB", "512000")),
        # Long media downloads/renders stream for minutes; 120s/180s would kill
        # large transfers mid-flight. Default to generous limits (still env-overridable).
        task_soft_time_limit=int(os.environ.get("CELERY_TASK_SOFT_TIME_LIMIT", "1500")),
        task_time_limit=int(os.environ.get("CELERY_TASK_TIME_LIMIT", "1800")),
        worker_pool=os.environ.get("CELERY_WORKER_POOL", "prefork"),
    )
else:
    celery_app = None


# ─── Celery Signal Connectors for Telemetry & Observability ───────────
if celery_available and celery_app:
    try:
        from celery.signals import task_success, task_failure
        import redis

        @task_success.connect
        def on_task_success(sender=None, **kwargs):
            if sender and hasattr(sender, "name"):
                try:
                    r_client = redis.Redis.from_url(REDIS_URL)
                    r_client.incr(f"metrics:tasks:success:{sender.name}")
                except Exception:
                    pass

        @task_failure.connect
        def on_task_failure(sender=None, **kwargs):
            if sender and hasattr(sender, "name"):
                try:
                    r_client = redis.Redis.from_url(REDIS_URL)
                    r_client.incr(f"metrics:tasks:failure:{sender.name}")
                except Exception:
                    pass
    except Exception:
        pass
