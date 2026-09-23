from __future__ import annotations

import asyncio
from typing import Any

from backend.celery_app import celery_app, celery_available
from backend.entitlements import build_effective_entitlement
from backend.extractor_service import extract_media_info, get_formats
from backend.format_parser import build_format_catalog
from backend.job_runner import run_download_job_sync


def _build_extract_payload(info: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    entitlement = user.get("entitlement") or build_effective_entitlement(user)
    include_owner_formats = bool(entitlement.get("4k_allowed") or user.get("is_owner"))
    catalog = build_format_catalog(info, include_owner_formats=include_owner_formats)
    video_formats = [item for item in catalog if item.get("type") == "video"]
    audio_formats = [item for item in catalog if item.get("type") == "audio"]
    return {
        "title": info.get("title", "Unknown Title"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "uploader": info.get("uploader") or info.get("channel"),
        "video_formats": video_formats,
        "audio_formats": audio_formats,
        "formats": video_formats + audio_formats,
        "entitlement": {
            "plan": entitlement.get("plan"),
            "role": entitlement.get("role"),
            "max_quality": entitlement.get("max_quality"),
            "4k_allowed": entitlement.get("4k_allowed"),
            "history_enabled": entitlement.get("history_enabled"),
            "queue_priority": entitlement.get("queue_priority"),
        },
    }


def _run_async(coro) -> Any:
    return asyncio.run(coro)


if celery_available and celery_app:

    @celery_app.task(name="tasks.metadata_probe_task")
    def metadata_probe_task(url: str, user: dict[str, Any] | None = None) -> dict[str, Any]:
        if user is None:
            return get_formats(url)
        info = extract_media_info(url, lightweight_probe=True)
        return _build_extract_payload(info, user)


    @celery_app.task(name="tasks.download_delivery_task")
    def download_delivery_task(
        job_id: str,
        payload: dict[str, Any],
        user: dict[str, Any],
    ) -> dict[str, Any]:
        run_download_job_sync(job_id, payload, user)
        return {
            "job_id": job_id,
            "status": "processed",
        }


    @celery_app.task(name="tasks.fallback_cleanup_task")
    def fallback_cleanup_task() -> dict[str, Any]:
        from backend.storage_handler import cleanup_expired_local_artifacts

        removed = cleanup_expired_local_artifacts()
        return {"status": "ok", "removed": removed}


    @celery_app.task(name="tasks.history_rollup_task")
    def history_rollup_task() -> dict[str, Any]:
        from backend.owner_router import refresh_history_rollups_best_effort

        return _run_async(refresh_history_rollups_best_effort())


    @celery_app.task(name="tasks.revenue_rollup_task")
    def revenue_rollup_task() -> dict[str, Any]:
        from backend.owner_router import refresh_revenue_rollups_best_effort

        return _run_async(refresh_revenue_rollups_best_effort())


    @celery_app.task(name="tasks.audit_rollup_task")
    def audit_rollup_task() -> dict[str, Any]:
        from backend.owner_router import refresh_audit_rollups_best_effort

        return _run_async(refresh_audit_rollups_best_effort())


    @celery_app.task(name="tasks.subscription_rollup_task")
    def subscription_rollup_task() -> dict[str, Any]:
        from backend.owner_router import refresh_subscription_rollups_best_effort

        return _run_async(refresh_subscription_rollups_best_effort())


    @celery_app.task(name="tasks.billing_reconciliation_task")
    def billing_reconciliation_task() -> dict[str, Any]:
        from backend.tasks import run_billing_reconciliation
        return _run_async(run_billing_reconciliation())


    @celery_app.task(name="tasks.abuse_rollup_task")
    def abuse_rollup_task() -> dict[str, Any]:
        from backend.owner_router import refresh_abuse_rollups_best_effort

        return _run_async(refresh_abuse_rollups_best_effort())


    @celery_app.task(name="tasks.proxy_rollup_task")
    def proxy_rollup_task() -> dict[str, Any]:
        from backend.owner_router import refresh_proxy_rollups_best_effort

        return _run_async(refresh_proxy_rollups_best_effort())


    @celery_app.task(name="tasks.proxy_alert_rollup_task")
    def proxy_alert_rollup_task() -> dict[str, Any]:
        from backend.owner_router import refresh_proxy_alert_rollups_best_effort

        return _run_async(refresh_proxy_alert_rollups_best_effort())


    @celery_app.task(name="tasks.proxy_breaker_posture_rollup_task")
    def proxy_breaker_posture_rollup_task() -> dict[str, Any]:
        from backend.owner_router import refresh_proxy_breaker_posture_rollups_best_effort

        return _run_async(refresh_proxy_breaker_posture_rollups_best_effort())


    @celery_app.task(name="tasks.proxy_alert_snapshot_task")
    def proxy_alert_snapshot_task() -> dict[str, Any]:
        from backend.owner_router import refresh_proxy_alert_snapshots_best_effort

        return _run_async(refresh_proxy_alert_snapshots_best_effort())


    @celery_app.task(name="tasks.proxy_auto_recovery_task")
    def proxy_auto_recovery_task() -> dict[str, Any]:
        from backend.proxy_state import probe_paused_providers

        return probe_paused_providers()


    @celery_app.task(name="tasks.proxy_circuit_breaker_task")
    def proxy_circuit_breaker_task() -> dict[str, Any]:
        from backend.proxy_state import enforce_circuit_breakers

        return enforce_circuit_breakers()


    @celery_app.task(name="tasks.update_ytdlp_nightly_task")
    def update_ytdlp_nightly_task() -> dict[str, Any]:
        """
        Periodically updates yt-dlp-nightly to ensure the engine always has the
        latest extraction logic and site-compatibility fixes.
        """
        import subprocess
        import sys

        try:
            # -U: Upgrade
            # --pre: Allow nightly/pre-release builds
            # --no-cache-dir: Don't use cached wheels, ensure fresh download from PyPI
            process = subprocess.run(
                [sys.executable, "-m", "pip", "install", "-U", "--pre", "--no-cache-dir", "yt-dlp[default]"],
                capture_output=True,
                text=True,
                check=True,
            )
            return {
                "status": "ok",
                "message": "yt-dlp-nightly updated successfully",
                "output": process.stdout.strip(),
            }
        except subprocess.CalledProcessError as e:
            return {
                "status": "error",
                "message": f"Failed to update yt-dlp-nightly: {str(e)}",
                "stderr": e.stderr.strip(),
            }

    @celery_app.task(name="backend.workers.proxy_state.metadata_probe_task")
    def proxy_metadata_probe_task(url: str, user: dict[str, Any] | None = None) -> dict[str, Any]:
        if user is None:
            return get_formats(url)
        info = extract_media_info(url, lightweight_probe=True)
        return _build_extract_payload(info, user)

    @celery_app.task(name="backend.workers.proxy_state.link_validation_task")
    def link_validation_task(url: str) -> bool:
        import httpx
        async def _validate():
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.head(url)
                return res.status_code < 400
        try:
            return _run_async(_validate())
        except Exception:
            return False

    @celery_app.task(name="backend.workers.syndication.webhook_dispatch_task")
    def webhook_dispatch_task(
        job_id: str,
        endpoint_url: str,
        payload: dict[str, Any],
        target_bot_platform: str = None,
        bot_recipient_id: str = None
    ) -> dict[str, Any]:
        from backend.workers.syndication import execute_webhook_delivery
        return _run_async(execute_webhook_delivery(
            job_id=job_id,
            endpoint_url=endpoint_url,
            payload=payload,
            target_bot_platform=target_bot_platform,
            bot_recipient_id=bot_recipient_id,
        ))

    @celery_app.task(name="backend.workers.syndication.execute_platform_upload_task")
    def execute_platform_upload_task(
        user_id: str,
        platform: str,
        access_token: str,
        refresh_token: str,
        video_url: str,
        caption: str,
        job_id: str
    ) -> dict[str, Any]:
        from backend.workers.syndication import execute_platform_upload
        return _run_async(execute_platform_upload(
            user_id=user_id,
            platform=platform,
            access_token=access_token,
            refresh_token=refresh_token,
            video_url=video_url,
            caption=caption,
            job_id=job_id
        ))

else:

    def metadata_probe_task(url: str, user: dict[str, Any] | None = None) -> dict[str, Any]:
        raise RuntimeError(
            "Celery is not installed or configured for metadata probes."
        )


    def download_delivery_task(
        job_id: str,
        payload: dict[str, Any],
        user: dict[str, Any],
    ) -> dict[str, Any]:
        raise RuntimeError(
            "Celery is not installed or configured for download delivery."
        )


    def fallback_cleanup_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def history_rollup_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def revenue_rollup_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def audit_rollup_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def subscription_rollup_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def billing_reconciliation_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def abuse_rollup_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def proxy_rollup_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def proxy_alert_rollup_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def proxy_breaker_posture_rollup_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def proxy_alert_snapshot_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def proxy_auto_recovery_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def proxy_circuit_breaker_task() -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for maintenance tasks.")


    def proxy_metadata_probe_task(url: str, user: dict[str, Any] | None = None) -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for metadata probes.")


    def link_validation_task(url: str) -> bool:
        raise RuntimeError("Celery is not installed or configured for link validation.")


    def webhook_dispatch_task(
        job_id: str,
        endpoint_url: str,
        payload: dict[str, Any],
        target_bot_platform: str = None,
        bot_recipient_id: str = None
    ) -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for webhook dispatch.")


    def execute_platform_upload_task(
        user_id: str,
        platform: str,
        access_token: str,
        refresh_token: str,
        video_url: str,
        caption: str,
        job_id: str
    ) -> dict[str, Any]:
        raise RuntimeError("Celery is not installed or configured for social platform upload.")


async def run_billing_reconciliation() -> dict[str, Any]:
    import logging
    import os
    from datetime import datetime, timedelta, timezone
    
    logger = logging.getLogger("nexus.billing_reconciliation")
    logger.info("Starting billing reconciliation & metered overage calculation task...")

    from backend.owner_router import refresh_billing_reconciliation_best_effort
    from backend.supabase_client import create_client
    from backend.payments import get_paddle_client, is_paddle_configured

    # 1. Run the base subscription reconciliation
    recon_result = {}
    try:
        recon_result = await refresh_billing_reconciliation_best_effort()
    except Exception as e:
        logger.error(f"Base billing reconciliation failed: {e}")
        recon_result = {"status": "error", "reason": str(e)}

    # 2. Check B2B Metered Billing Overage
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not supabase_url or not supabase_key:
        logger.warning("Supabase credentials missing, skipping metered overage reconciliation.")
        return {**recon_result, "metered_overages": []}

    overage_details = []
    try:
        supabase = create_client(supabase_url, supabase_key)
        # Scan profiles for B2B developer plans
        profiles_res = supabase.table("profiles").select("id, email, plan, paddle_customer_id, paddle_subscription_id").execute()
        if not profiles_res.data or profiles_res.error:
            logger.warning(f"No B2B profiles found or error: {profiles_res.error}")
            return {**recon_result, "metered_overages": []}

        # Filter B2B profiles
        b2b_plans = {"api", "api_growth", "enterprise"}
        b2b_profiles = [p for p in profiles_res.data if str(p.get("plan")).strip().lower() in b2b_plans]

        # Calculate limit settings
        plan_limits = {
            "api": {"limit": 150000, "rate": 0.0005},
            "api_growth": {"limit": 750000, "rate": 0.0002},
            "enterprise": {"limit": 3000000, "rate": 0.0001}
        }

        start_day = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")

        for profile in b2b_profiles:
            user_id = profile["id"]
            email = profile.get("email") or "Unknown"
            plan = str(profile.get("plan")).strip().lower()
            paddle_sub_id = profile.get("paddle_subscription_id")

            # Sum request counts in last 30 days
            usage_res = supabase.table("api_key_usage_daily").select("request_count").eq("user_id", user_id).gte("day", start_day).execute()
            
            total_requests = 0
            if usage_res.data and not usage_res.error:
                total_requests = sum(int(row.get("request_count") or 0) for row in usage_res.data)

            limits = plan_limits.get(plan, {"limit": 150000, "rate": 0.0005})
            monthly_allowance = limits["limit"]
            overage_rate = limits["rate"]

            overage_requests = max(0, total_requests - monthly_allowance)
            overage_cost = overage_requests * overage_rate

            if overage_cost > 0:
                logger.info(f"Overage detected for B2B User {user_id} ({email}). Usage: {total_requests}/{monthly_allowance} requests. Overage Cost: ${overage_cost:.2f}")
                
                # Charge Paddle
                paddle_billed = False
                paddle_error = None
                if is_paddle_configured() and paddle_sub_id:
                    try:
                        paddle = get_paddle_client()
                        overage_price_id = os.environ.get("PADDLE_METERED_OVERAGE_PRICE_ID")
                        if overage_price_id:
                            paddle.transactions.create({
                                "items": [{"price_id": overage_price_id, "quantity": overage_requests}],
                                "customer_id": profile.get("paddle_customer_id"),
                                "collection_mode": "automatic",
                                "subscription_id": paddle_sub_id
                            })
                            paddle_billed = True
                        else:
                            paddle_error = "PADDLE_METERED_OVERAGE_PRICE_ID environment variable not set."
                    except Exception as err:
                        paddle_error = str(err)
                        logger.error(f"Failed to submit Paddle transaction: {err}")
                else:
                    paddle_error = "Paddle not configured or subscription ID missing on user profile."

                overage_details.append({
                    "user_id": user_id,
                    "email": email,
                    "plan": plan,
                    "usage": total_requests,
                    "allowance": monthly_allowance,
                    "overage_cost": overage_cost,
                    "paddle_billed": paddle_billed,
                    "paddle_error": paddle_error
                })

    except Exception as e:
        logger.error(f"Failed B2B metered overage calculations: {e}", exc_info=True)

    return {
        **recon_result,
        "metered_overages": overage_details
    }

