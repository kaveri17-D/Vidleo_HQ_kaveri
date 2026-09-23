from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import ipaddress
import logging
import os
import re
import secrets
import shutil
import socket
import urllib.request
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urlparse

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from starlette.background import BackgroundTask

BACKEND_DIR = Path(__file__).resolve().parent
from backend import payments
from backend.api_v1.history import router as history_router
from backend.api_v1.router import router as api_v1_router
from backend.auth import check_user_limit, enforce_consumer_rate_limit, get_current_user
from backend.celery_app import celery_app, celery_available
from backend.campaigns import (
    DEFAULT_FREE_LIMIT,
    DEFAULT_FREE_QUALITIES,
    DEFAULT_PRO_LIMIT,
    DEFAULT_PRO_QUALITIES,
    get_campaign_snapshot,
    set_user_override,
    update_campaign_settings,
)
from backend.download_handler import create_temp_output, download_selected_media
from backend.entitlements import build_effective_entitlement
from backend.extractor_service import (
    MediaExtractionError,
    ensure_media_binaries,
    extract_media_info,
    extract_media_info_async,
    get_cached_probe_payload,
    get_provider_capability,
    get_provider_name,
)
from backend.format_parser import (
    MAX_DISCORD_BYTES,
    MAX_TELEGRAM_BYTES,
    _pick_best_thumbnail,
    build_format_catalog,
    filter_for_discord,
    filter_for_telegram,
    find_format_option,
)
from backend.job_runner import run_download_job_async
from backend.job_store import add_job_event, claim_or_find_active_download, get_job, register_job, summarize_jobs, update_job
from backend.media_url import normalize_media_url
from backend.owner_router import (
    get_runtime_ops_state,
    refresh_billing_reconciliation_best_effort,
    refresh_abuse_rollups_best_effort,
    refresh_audit_rollups_best_effort,
    refresh_history_rollups_best_effort,
    refresh_proxy_alert_rollups_best_effort,
    refresh_proxy_breaker_posture_rollups_best_effort,
    refresh_proxy_alert_snapshots_best_effort,
    refresh_proxy_rollups_best_effort,
    refresh_revenue_rollups_best_effort,
    refresh_subscription_rollups_best_effort,
    router as owner_router,
)
from backend.proxy_state import enforce_circuit_breakers, get_proxy_telemetry, probe_paused_providers
from backend.pricing_runtime import (
    DEFAULT_ELITE_BASE,
    DEFAULT_ELITE_CURRENT,
    MIN_ELITE_THRESHOLD,
    get_pricing_snapshot,
    pricing_preview_charge_inr,
    pricing_preview_charge_usd_cents,
    update_pricing_settings,
)
from backend.queue_incidents import record_queue_incident
from backend.referrals import router as referrals_router
from backend.security import verify_unkey_token
from backend.storage_handler import cleanup_expired_local_artifacts, get_local_artifact_stats, resolve_local_artifact
from backend.tasks import download_delivery_task, metadata_probe_task
from backend.middleware.credit_gate import CreditGateMiddleware, load_redis_ledger_functions

load_dotenv(Path(__file__).parent / ".env", override=False)

BIN_DIR = BACKEND_DIR / "bin"
if BIN_DIR.exists():
    os.environ["PATH"] = str(BIN_DIR) + os.pathsep + os.environ.get("PATH", "")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s - %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("media-extractor")

redis_url = os.environ.get("REDIS_URL")
limiter = Limiter(key_func=get_remote_address, storage_uri=redis_url if redis_url else "memory://")

app = FastAPI(
    title="Zero-Storage Media Extractor",
    description="Binary-first media extraction with dynamic format selection and job progress tracking.",
    version="3.0.0",
)
app.state.limiter = limiter
app.add_middleware(CreditGateMiddleware)
app.add_middleware(SlowAPIMiddleware)

# ─── Prometheus Instrumentation Setup ────────────────────────────
import time
try:
    from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
    
    NEXUS_HTTP_REQUESTS_TOTAL = Counter(
        "nexus_http_requests_total",
        "Total count of HTTP requests",
        ["method", "endpoint", "status"]
    )

    NEXUS_HTTP_REQUEST_DURATION_SECONDS = Histogram(
        "nexus_http_request_duration_seconds",
        "HTTP request latency in seconds",
        ["method", "endpoint"]
    )

    NEXUS_CELERY_TASKS_SUCCESS_TOTAL = Gauge(
        "nexus_celery_tasks_success_total",
        "Total successfully processed Celery tasks",
        ["task_name"]
    )

    NEXUS_CELERY_TASKS_FAILURE_TOTAL = Gauge(
        "nexus_celery_tasks_failure_total",
        "Total failed Celery tasks",
        ["task_name"]
    )
    
    @app.middleware("http")
    async def prometheus_metrics_middleware(request: Request, call_next):
        method = request.method
        endpoint = request.url.path
        if endpoint == "/metrics":
            return await call_next(request)
            
        start_time = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start_time
        
        status = response.status_code
        NEXUS_HTTP_REQUESTS_TOTAL.labels(method=method, endpoint=endpoint, status=status).inc()
        NEXUS_HTTP_REQUEST_DURATION_SECONDS.labels(method=method, endpoint=endpoint).observe(duration)
        
        return response
except Exception as exc:
    log.warning("Prometheus instrumentation initialization skipped: %s", exc)


class ExtractRequest(BaseModel):
    url: str = Field(min_length=10, max_length=2048)


MAX_DOWNLOAD_FILENAME_LENGTH = 180


def _sanitize_download_filename(value: object) -> str | None:
    if value is None:
        return None

    text = "".join(char for char in str(value) if char.isalnum() or char in " _-()").strip()
    if not text:
        return None

    return text[:MAX_DOWNLOAD_FILENAME_LENGTH].rstrip(" ._-()") or "download"


class DownloadRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    url: str = Field(min_length=10, max_length=2048)
    format_id: str = Field(
        min_length=1,
        max_length=100,
        validation_alias=AliasChoices("format_id", "formatId"),
        serialization_alias="format_id",
    )
    format_type: Literal["video", "audio"] = Field(
        default="video",
        validation_alias=AliasChoices("format_type", "formatType"),
        serialization_alias="format_type",
    )
    filename: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("filename", "fileName"),
        serialization_alias="filename",
    )
    delivery_target: Literal["web", "telegram", "discord"] = Field(
        default="web",
        validation_alias=AliasChoices("delivery_target", "deliveryTarget"),
        serialization_alias="delivery_target",
    )

    @field_validator("format_id", mode="before")
    @classmethod
    def _normalize_format_id(cls, value: object) -> str:
        return str(value or "").strip()

    @field_validator("format_type", mode="before")
    @classmethod
    def _normalize_format_type(cls, value: object) -> object:
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"audio-mp3", "audio_mp3", "mp3"}:
                return "audio"
            return lowered
        return value

    @field_validator("filename", mode="before")
    @classmethod
    def _normalize_filename(cls, value: object) -> str | None:
        return _sanitize_download_filename(value)

    @field_validator("delivery_target", mode="before")
    @classmethod
    def _normalize_delivery_target(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value


class CampaignLimitPayload(BaseModel):
    free: int | None = None
    pro: int | None = None


class CampaignQualityPayload(BaseModel):
    free: list[str] | None = None
    pro: list[str] | None = None


class CampaignOverridePayload(BaseModel):
    user_id: str = Field(min_length=1, max_length=255)
    limit: int | None = None
    quality: list[str] | None = None
    remove: bool = False


class PricingSalePayload(BaseModel):
    is_active: bool | None = None
    message: str | None = Field(default=None, max_length=500)
    end_timestamp: int | None = None


class PricingElitePayload(BaseModel):
    base: int | None = None
    current: int | None = None


class PricingConfigPayload(BaseModel):
    elite_monthly: PricingElitePayload | None = None
    sale: PricingSalePayload | None = None


class CampaignConfigPayload(BaseModel):
    active_message: str | None = Field(default=None, max_length=500)
    limit: CampaignLimitPayload | None = None
    quality: CampaignQualityPayload | None = None
    override: CampaignOverridePayload | None = None
    pricing: PricingConfigPayload | None = None


DOWNLOAD_JOBS: dict[str, dict] = {}
DOWNLOAD_LOCK = asyncio.Lock()
USE_CELERY_DOWNLOADS = os.environ.get("NEXUS_USE_CELERY", "0") == "1" and celery_available and celery_app is not None
# Metadata scans must stay latency-first.  They only use Celery when explicitly
# enabled, otherwise /api/info goes straight to the fast local extraction path.
USE_CELERY_METADATA_PROBES = (
    os.environ.get("NEXUS_USE_CELERY_METADATA_PROBES", "0") == "1"
    and USE_CELERY_DOWNLOADS
)
USE_CELERY_BEAT_SCHEDULER = (
    os.environ.get("NEXUS_USE_CELERY_BEAT", "0") == "1"
    and USE_CELERY_DOWNLOADS
)
FALLBACK_CLEANUP_INTERVAL_SECONDS = max(60, int(os.environ.get("FALLBACK_CLEANUP_INTERVAL_SECONDS", "900")))
FALLBACK_CLEANUP_TASK: asyncio.Task | None = None
VAULT_HISTORY_ROLLUP_INTERVAL_SECONDS = max(300, int(os.environ.get("VAULT_HISTORY_ROLLUP_INTERVAL_SECONDS", "1800")))
VAULT_HISTORY_ROLLUP_TASK: asyncio.Task | None = None
REVENUE_ROLLUP_INTERVAL_SECONDS = max(300, int(os.environ.get("REVENUE_ROLLUP_INTERVAL_SECONDS", "1800")))
REVENUE_ROLLUP_TASK: asyncio.Task | None = None
AUDIT_ROLLUP_INTERVAL_SECONDS = max(300, int(os.environ.get("AUDIT_ROLLUP_INTERVAL_SECONDS", "1800")))
AUDIT_ROLLUP_TASK: asyncio.Task | None = None
SUBSCRIPTION_ROLLUP_INTERVAL_SECONDS = max(300, int(os.environ.get("SUBSCRIPTION_ROLLUP_INTERVAL_SECONDS", "1800")))
SUBSCRIPTION_ROLLUP_TASK: asyncio.Task | None = None
BILLING_RECONCILIATION_INTERVAL_SECONDS = max(900, int(os.environ.get("BILLING_RECONCILIATION_INTERVAL_SECONDS", "3600")))
BILLING_RECONCILIATION_TASK: asyncio.Task | None = None
ABUSE_ROLLUP_INTERVAL_SECONDS = max(300, int(os.environ.get("ABUSE_ROLLUP_INTERVAL_SECONDS", "1800")))
ABUSE_ROLLUP_TASK: asyncio.Task | None = None
PROXY_ROLLUP_FLUSH_INTERVAL_SECONDS = max(60, int(os.environ.get("PROXY_ROLLUP_FLUSH_INTERVAL_SECONDS", "300")))
PROXY_ROLLUP_TASK: asyncio.Task | None = None
PROXY_ALERT_ROLLUP_INTERVAL_SECONDS = max(300, int(os.environ.get("PROXY_ALERT_ROLLUP_INTERVAL_SECONDS", "1800")))
PROXY_ALERT_ROLLUP_TASK: asyncio.Task | None = None
PROXY_BREAKER_POSTURE_ROLLUP_INTERVAL_SECONDS = max(300, int(os.environ.get("PROXY_BREAKER_POSTURE_ROLLUP_INTERVAL_SECONDS", "1800")))
PROXY_BREAKER_POSTURE_ROLLUP_TASK: asyncio.Task | None = None
PROXY_ALERT_SNAPSHOT_INTERVAL_SECONDS = max(300, int(os.environ.get("PROXY_ALERT_SNAPSHOT_INTERVAL_SECONDS", "3600")))
PROXY_ALERT_SNAPSHOT_TASK: asyncio.Task | None = None
PROXY_AUTO_RECOVERY_POLL_INTERVAL_SECONDS = max(300, int(os.environ.get("PROXY_AUTO_RECOVERY_POLL_INTERVAL_SECONDS", "600")))
PROXY_AUTO_RECOVERY_TASK: asyncio.Task | None = None
PROXY_CIRCUIT_BREAKER_WATCHDOG_SECONDS = 60
PROXY_CIRCUIT_BREAKER_TASK: asyncio.Task | None = None

_BLOCKED_SCHEMES = frozenset(["file", "ftp", "sftp", "gopher", "data", "ldap", "dict", "jar"])
_PRIVATE_RANGES = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]
_MAX_URL_LENGTH = 2048
INFINITE_FEED_REGEX = re.compile(r"list=RD|feed/|playlist\?list=WL", re.IGNORECASE)


async def custom_rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(content={"error": "Rate limit exceeded. Please try again later."}, status_code=429)


app.add_exception_handler(RateLimitExceeded, custom_rate_limit_handler)


def _require_campaign_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("anonymous"):
        raise HTTPException(status_code=401, detail="Authentication required.")
    if not (user.get("is_owner") or str(user.get("role") or "").strip().lower() == "admin"):
        raise HTTPException(status_code=403, detail="Owner or admin access required.")
    return user

def _resolve_cors_mode() -> tuple[str, list[str]]:
    cors_raw = os.environ.get("ALLOWED_ORIGINS", "")
    cors_origins = [o.strip() for o in cors_raw.split(",") if o.strip()] if cors_raw else []
    if not cors_origins:
        cors_origins = ["https://nexus-media-engine.vercel.app", "http://localhost:3000"]

    requested_mode = os.environ.get("NEXUS_CORS_OWNER", "auto").strip().lower()
    if requested_mode not in {"auto", "app", "nginx"}:
        requested_mode = "auto"

    if requested_mode == "auto":
        web_url = os.environ.get("NEXUS_WEB_URL", "").strip().lower()
        localhost_hosts = ("localhost", "127.0.0.1")
        is_local_dev = any(host in web_url for host in localhost_hosts) or all(
            any(host in origin.lower() for host in localhost_hosts) for origin in cors_origins
        )
        requested_mode = "app" if is_local_dev else "nginx"

    return requested_mode, cors_origins


_cors_mode, _cors_origins = _resolve_cors_mode()
if _cors_mode == "app":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )
    log.info("CORS owner: FastAPI app")
else:
    log.info("CORS owner: Nginx / external proxy")

app.include_router(api_v1_router)
app.include_router(history_router)
app.include_router(owner_router)
app.include_router(payments.router)
app.include_router(referrals_router)

FRONTEND_APP_URL = (
    os.environ.get("NEXUS_WEB_URL")
    or os.environ.get("NEXT_PUBLIC_APP_URL")
    or "https://nexus-media-engine.vercel.app"
).rstrip("/")

NEXUS_STYLE = """
<style>
  :root {
    color-scheme: dark;
    --obsidian: #000000;
    --panel: rgba(9, 14, 18, 0.92);
    --panel-border: rgba(0, 255, 255, 0.2);
    --text: #f5f7fb;
    --muted: #9aa6b2;
    --cyan: #00ffff;
    --violet: #7c3aed;
    --grid: rgba(0, 255, 255, 0.08);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(circle at top, rgba(0, 255, 255, 0.12), transparent 34rem),
      linear-gradient(180deg, rgba(124, 58, 237, 0.12), transparent 28rem),
      linear-gradient(var(--grid) 1px, transparent 1px),
      linear-gradient(90deg, var(--grid) 1px, transparent 1px),
      var(--obsidian);
    background-size: auto, auto, 44px 44px, 44px 44px, auto;
    color: var(--text);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.72;
    padding: 48px 20px 80px;
  }

  .shell {
    max-width: 920px;
    margin: 0 auto;
  }

  .hero,
  .section {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 24px;
    backdrop-filter: blur(14px);
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  }

  .hero {
    padding: 32px;
    margin-bottom: 24px;
  }

  .eyebrow {
    display: inline-block;
    color: var(--cyan);
    font-size: 0.78rem;
    letter-spacing: 0.35em;
    text-transform: uppercase;
    margin-bottom: 12px;
  }

  h1 {
    margin: 0;
    color: var(--text);
    font-size: clamp(2rem, 4.8vw, 3.9rem);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  h1 .accent,
  h2 {
    color: var(--cyan);
  }

  .lede {
    max-width: 62ch;
    color: var(--muted);
    font-size: 1rem;
    margin-top: 18px;
  }

  .section {
    padding: 26px 28px;
    margin-bottom: 18px;
  }

  h2 {
    margin: 0 0 12px;
    font-size: 1.08rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  p, li {
    color: var(--muted);
    font-size: 0.98rem;
    margin: 0;
  }

  ul {
    margin: 12px 0 0 22px;
    padding: 0;
  }

  li + li,
  p + p {
    margin-top: 10px;
  }

  .node {
    color: var(--violet);
    font-weight: 700;
  }

  a {
    color: var(--cyan);
  }

  .footer {
    color: var(--muted);
    font-size: 0.9rem;
    margin-top: 26px;
    text-align: center;
  }

  @media (max-width: 640px) {
    body { padding: 28px 14px 56px; }
    .hero, .section { border-radius: 18px; }
    .hero { padding: 24px; }
    .section { padding: 20px; }
  }
</style>
"""


def _render_policy_page(title: str, subtitle: str, sections: list[tuple[str, str]]) -> HTMLResponse:
    rendered_sections = "".join(
        f"<section class='section'><h2>{heading}</h2><p>{body}</p></section>"
        for heading, body in sections
    )
    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title} | NEXUS Media Engine</title>
    <meta
      name="description"
      content="NEXUS Media Engine legal disclosures for Google verification, user transparency, and platform governance."
    />
    {NEXUS_STYLE}
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="eyebrow">NEXUS Media Engine / Legal</div>
        <h1>{title} <span class="accent">Protocol</span></h1>
        <p class="lede">{subtitle}</p>
      </section>
      {rendered_sections}
      <p class="footer">NEXUS Media Engine · nexus-engine.me · authoritative platform disclosure</p>
    </main>
  </body>
</html>"""
    return HTMLResponse(content=html, status_code=200)


@app.get("/", include_in_schema=False)
async def root_redirect() -> RedirectResponse:
    return RedirectResponse(url=FRONTEND_APP_URL, status_code=307)


@app.get("/login", include_in_schema=False)
async def login_redirect() -> RedirectResponse:
    return RedirectResponse(url=f"{FRONTEND_APP_URL}/login", status_code=307)


@app.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
async def privacy_page() -> HTMLResponse:
    return _render_policy_page(
        title="Privacy",
        subtitle=(
            "NEXUS Media Engine is engineered for low-retention media processing, transparent identity flows, "
            "and controlled third-party integrations. This page is public so it can be crawled by Google and other "
            "verification systems without authentication."
        ),
        sections=[
            (
                "Data Sovereignty",
                "Authentication and account identity may be provided through Google Sign-In and Supabase Auth. "
                "Where personal data is processed, NEXUS Media Engine acts only as necessary to create accounts, "
                "maintain sessions, secure access, and enforce subscription entitlements. We limit internal access, "
                "retain only the minimum data required for service integrity, and process user information in line "
                "with our operational, legal, and security obligations.",
            ),
            (
                "Media Processing",
                "Submitted URLs, extraction metadata, queue events, and temporary delivery artifacts may be processed "
                "to inspect formats, execute downloads, and return the requested result. NEXUS Media Engine is designed "
                "for ephemeral handling rather than long-term storage of media payloads. Temporary files are cleared on "
                "a rolling basis and are not retained longer than necessary to fulfill the active request, investigate "
                "abuse, or maintain system reliability.",
            ),
            (
                "Third-Party Integration",
                "NEXUS Media Engine relies on trusted infrastructure partners for narrow platform functions. "
                "<span class='node'>Supabase</span> may provide authentication, session persistence, and application data storage. "
                "<span class='node'>Razorpay</span> may process billing, subscription payments, and transaction references. "
                "These providers operate under their own terms and privacy commitments, and only the minimum required data "
                "is shared with them to deliver the service.",
            ),
            (
                "Operational Security",
                "We may log request metadata, rate-limit events, proxy posture, and error telemetry to defend the platform, "
                "prevent abuse, and preserve service availability. These controls exist to secure the API, worker queue, "
                "and public endpoints without exposing download content beyond what is necessary to complete user-initiated tasks.",
            ),
        ],
    )


@app.get("/terms", response_class=HTMLResponse, include_in_schema=False)
async def terms_page() -> HTMLResponse:
    return _render_policy_page(
        title="Terms",
        subtitle=(
            "These public service terms define the acceptable use boundary for NEXUS Media Engine, including lawful "
            "media extraction, account conduct, and protection of core infrastructure."
        ),
        sections=[
            (
                "Acceptance of Terms",
                "By accessing nexus-engine.me, creating an account, or submitting a media request, you agree to these "
                "Terms of Service. If you do not accept them, you must not use the platform. These routes are intentionally "
                "public and require no authentication so they remain accessible to verification crawlers and end users alike.",
            ),
            (
                "Fair Use and Copyright",
                "NEXUS Media Engine is a technical utility, not a rights grant. You may use the platform only for personal, "
                "authorized, or otherwise lawful purposes. You are responsible for determining whether a requested extraction "
                "or download is permitted by copyright law, fair dealing, fair use, platform rules, license terms, or rights-holder consent. "
                "You must not use the service to infringe intellectual property rights or redistribute protected works without authorization.",
            ),
            (
                "Prohibited Conduct",
                "Mass scraping, abusive automation, credential misuse, unlawful surveillance, queue flooding, resale of access, "
                "attempts to defeat rate limits, attacks on upstream providers, and any use that degrades platform stability are prohibited. "
                "We reserve the right to throttle, suspend, or permanently terminate access where abuse, fraud, or elevated legal risk is detected.",
            ),
            (
                "Service Boundaries",
                "Availability may vary by source platform, queue pressure, anti-bot conditions, and upstream restrictions. "
                "NEXUS Media Engine may apply API rate limits, proxy controls, temporary delivery windows, and entitlement checks "
                "to protect service quality and maintain lawful operation across Free, Pro, and Premium plan tiers.",
            ),
        ],
    )


def _is_private_ip(hostname: str) -> bool:
    try:
        addr = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)[0][4][0]
        ip = ipaddress.ip_address(addr)
        return any(ip in net for net in _PRIVATE_RANGES)
    except (socket.gaierror, ValueError):
        return True


def _validate_media_url(url: str) -> str:
    if not url or not isinstance(url, str):
        raise HTTPException(status_code=400, detail="Invalid or unsupported URL")

    normalized = normalize_media_url(url.strip())
    if len(normalized) > _MAX_URL_LENGTH:
        raise HTTPException(status_code=400, detail="Invalid or unsupported URL")

    parsed = urlparse(normalized)
    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https") or scheme in _BLOCKED_SCHEMES:
        raise HTTPException(status_code=400, detail="Invalid or unsupported URL")

    hostname = parsed.hostname or ""
    if not hostname or hostname.lower() in {"localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"}:
        raise HTTPException(status_code=400, detail="Invalid or unsupported URL")

    if _is_private_ip(hostname):
        raise HTTPException(status_code=400, detail="Invalid or unsupported URL")

    if INFINITE_FEED_REGEX.search(normalized):
        raise HTTPException(status_code=400, detail="Invalid or unsupported URL")

    return normalized


def _cleanup_temp(path: Optional[str]) -> None:
    if not path:
        return
    try:
        if os.path.exists(path):
            shutil.rmtree(path, ignore_errors=True)
    except Exception as exc:
        log.error("Failed to clean temp dir %s: %s", path, exc)


async def _store_job(job_id: str, **updates) -> None:
    async with DOWNLOAD_LOCK:
        current = DOWNLOAD_JOBS.get(job_id, {})
        current.update(updates)
        DOWNLOAD_JOBS[job_id] = current
    await update_job(job_id, **updates)


async def _fallback_cleanup_loop() -> None:
    while True:
        try:
            cleaned = cleanup_expired_local_artifacts()
            if cleaned:
                log.info("Fallback cleanup removed %s expired artifact(s).", cleaned)
        except Exception as exc:
            log.warning("Fallback cleanup loop failed: %s", exc)
        await asyncio.sleep(FALLBACK_CLEANUP_INTERVAL_SECONDS)


async def _vault_history_rollup_loop() -> None:
    while True:
        try:
            result = await refresh_history_rollups_best_effort()
            if result.get("persisted"):
                log.info(
                    "Vault history rollups refreshed: %s source rows -> %s rollup rows.",
                    result.get("source_rows"),
                    result.get("rollup_rows"),
                )
        except Exception as exc:
            log.warning("Vault history rollup loop failed: %s", exc)
        await asyncio.sleep(VAULT_HISTORY_ROLLUP_INTERVAL_SECONDS)


async def _revenue_rollup_loop() -> None:
    while True:
        try:
            result = await refresh_revenue_rollups_best_effort()
            if result.get("persisted"):
                log.info(
                    "Revenue rollups refreshed: %s source rows -> %s rollup rows.",
                    result.get("source_rows"),
                    result.get("rollup_rows"),
                )
        except Exception as exc:
            log.warning("Revenue rollup loop failed: %s", exc)
        await asyncio.sleep(REVENUE_ROLLUP_INTERVAL_SECONDS)


async def _audit_rollup_loop() -> None:
    while True:
        try:
            result = await refresh_audit_rollups_best_effort()
            if result.get("persisted"):
                log.info(
                    "Audit rollups refreshed: %s source rows -> %s rollup rows.",
                    result.get("source_rows"),
                    result.get("rollup_rows"),
                )
        except Exception as exc:
            log.warning("Audit rollup loop failed: %s", exc)
        await asyncio.sleep(AUDIT_ROLLUP_INTERVAL_SECONDS)


async def _subscription_rollup_loop() -> None:
    while True:
        try:
            result = await refresh_subscription_rollups_best_effort()
            if result.get("persisted"):
                log.info(
                    "Subscription rollups refreshed: %s source rows -> %s rollup rows.",
                    result.get("source_rows"),
                    result.get("rollup_rows"),
                )
        except Exception as exc:
            log.warning("Subscription rollup loop failed: %s", exc)
        await asyncio.sleep(SUBSCRIPTION_ROLLUP_INTERVAL_SECONDS)


async def _billing_reconciliation_loop() -> None:
    while True:
        try:
            result = await refresh_billing_reconciliation_best_effort()
            if result.get("status") == "ok":
                log.info(
                    "Billing reconciliation refreshed: %s source rows / %s reconciled / %s skipped.",
                    result.get("source_rows"),
                    result.get("reconciled_rows"),
                    result.get("skipped_rows"),
                )
        except Exception as exc:
            log.warning("Billing reconciliation loop failed: %s", exc)
        await asyncio.sleep(BILLING_RECONCILIATION_INTERVAL_SECONDS)


async def _abuse_rollup_loop() -> None:
    while True:
        try:
            result = await refresh_abuse_rollups_best_effort()
            if result.get("persisted"):
                log.info(
                    "Abuse rollups refreshed: %s source rows -> %s rollup rows.",
                    result.get("source_rows"),
                    result.get("rollup_rows"),
                )
        except Exception as exc:
            log.warning("Abuse rollup loop failed: %s", exc)
        await asyncio.sleep(ABUSE_ROLLUP_INTERVAL_SECONDS)


async def _proxy_rollup_loop() -> None:
    while True:
        try:
            result = await refresh_proxy_rollups_best_effort()
            if result.get("persisted"):
                log.info(
                    "Proxy rollups flushed: %s source providers -> %s rollup rows.",
                    result.get("source_rows"),
                    result.get("rollup_rows"),
                )
        except Exception as exc:
            log.warning("Proxy rollup loop failed: %s", exc)
        await asyncio.sleep(PROXY_ROLLUP_FLUSH_INTERVAL_SECONDS)


async def _proxy_alert_rollup_loop() -> None:
    while True:
        try:
            result = await refresh_proxy_alert_rollups_best_effort()
            if result.get("persisted"):
                log.info(
                    "Proxy breaker rollups refreshed: %s source rows -> %s rollup rows.",
                    result.get("source_rows"),
                    result.get("rollup_rows"),
                )
        except Exception as exc:
            log.warning("Proxy breaker rollup loop failed: %s", exc)
        await asyncio.sleep(PROXY_ALERT_ROLLUP_INTERVAL_SECONDS)


async def _proxy_breaker_posture_rollup_loop() -> None:
    while True:
        try:
            result = await refresh_proxy_breaker_posture_rollups_best_effort()
            if result.get("persisted"):
                log.info(
                    "Proxy breaker posture rollups refreshed: %s source rows -> %s rollup rows.",
                    result.get("source_rows"),
                    result.get("rollup_rows"),
                )
        except Exception as exc:
            log.warning("Proxy breaker posture rollup loop failed: %s", exc)
        await asyncio.sleep(PROXY_BREAKER_POSTURE_ROLLUP_INTERVAL_SECONDS)


async def _proxy_alert_snapshot_loop() -> None:
    while True:
        try:
            result = await refresh_proxy_alert_snapshots_best_effort()
            if result.get("persisted"):
                log.info(
                    "Proxy alert snapshots refreshed: %s providers -> %s snapshot rows.",
                    result.get("source_rows"),
                    result.get("rollup_rows"),
                )
        except Exception as exc:
            log.warning("Proxy alert snapshot loop failed: %s", exc)
        await asyncio.sleep(PROXY_ALERT_SNAPSHOT_INTERVAL_SECONDS)


async def _proxy_auto_recovery_loop() -> None:
    while True:
        try:
            result = await asyncio.to_thread(probe_paused_providers)
            if result.get("opened_providers"):
                log.info(
                    "Proxy auto-recovery opened %s provider(s) for half-open health checks.",
                    result.get("opened_providers"),
                )
        except Exception as exc:
            log.warning("Proxy auto-recovery loop failed: %s", exc)
        await asyncio.sleep(PROXY_AUTO_RECOVERY_POLL_INTERVAL_SECONDS)


async def _proxy_circuit_breaker_loop() -> None:
    while True:
        try:
            result = await asyncio.to_thread(enforce_circuit_breakers)
            if result.get("tripped"):
                log.warning(
                    "Proxy circuit breaker tripped %s provider(s) after evaluating %s provider(s).",
                    result.get("tripped"),
                    result.get("evaluated"),
                )
        except Exception as exc:
            log.warning("Proxy circuit breaker loop failed: %s", exc)
        await asyncio.sleep(PROXY_CIRCUIT_BREAKER_WATCHDOG_SECONDS)


async def _extract_payload_for_user(url: str, user: dict) -> dict:
    info = await extract_media_info_async(url, lightweight_probe=True)
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


async def _run_extract_probe(url: str, user: dict) -> dict:
    if not USE_CELERY_METADATA_PROBES:
        return await _extract_payload_for_user(url, user)

    cached = get_cached_probe_payload(url)
    if cached:
        entitlement = user.get("entitlement") or build_effective_entitlement(user)
        include_owner_formats = bool(entitlement.get("4k_allowed") or user.get("is_owner"))
        catalog = build_format_catalog(cached, include_owner_formats=include_owner_formats)
        video_formats = [item for item in catalog if item.get("type") == "video"]
        audio_formats = [item for item in catalog if item.get("type") == "audio"]
        return {
            "title": cached.get("title", "Unknown Title"),
            "duration": cached.get("duration"),
            "thumbnail": cached.get("thumbnail"),
            "uploader": cached.get("uploader") or cached.get("channel"),
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

    probe_job_id = f"probe_{secrets.token_urlsafe(12)}"
    provider = get_provider_name(url)
    await register_job(
        probe_job_id,
        {
            "user_id": user.get("id"),
            "source_channel": "web_extract",
            "provider": provider,
            "normalized_url": url,
            "requested_format_id": None,
            "requested_media_type": "metadata",
            "queue_name": "metadata_worker",
            "priority": "metadata_worker",
            "status": "queued",
            "progress": 0,
            "runner": "celery",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    await add_job_event(probe_job_id, "probe_queued", {"provider": provider})
    await _store_job(probe_job_id, status="queued", progress=0, runner="celery", error=None)

    try:
        result = metadata_probe_task.delay(url, user)
        await update_job(probe_job_id, celery_task_id=result.id, status="processing", progress=10)
        await add_job_event(probe_job_id, "probe_dispatched", {"celery_task_id": result.id})
        payload = await asyncio.wait_for(asyncio.to_thread(result.get, timeout=60), timeout=65)
        await update_job(
            probe_job_id,
            status="completed",
            progress=100,
            filename=payload.get("title"),
            result_asset_id=payload.get("title"),
        )
        await add_job_event(probe_job_id, "probe_completed", {"title": payload.get("title")})
        return payload
    except Exception as exc:
        log.warning("Celery metadata probe fallback for %s: %s", probe_job_id, exc)
        await record_queue_incident(
            provider="celery",
            incident_type="metadata_probe_fallback",
            queue_name="metadata_worker",
            job_id=probe_job_id,
            runner="celery",
            detail=str(exc),
        )
        await update_job(
            probe_job_id,
            status="processing",
            progress=25,
            runner="local_async",
            error="Celery probe fallback activated",
            code="probe_fallback",
        )
        await add_job_event(probe_job_id, "probe_fallback_local", {"error": str(exc)})
        try:
            payload = await _extract_payload_for_user(url, user)
            await update_job(
                probe_job_id,
                status="completed",
                progress=100,
                filename=payload.get("title"),
                result_asset_id=payload.get("title"),
                error=None,
                code=None,
            )
            await add_job_event(probe_job_id, "probe_completed", {"title": payload.get("title"), "runner": "local_async"})
            return payload
        except MediaExtractionError as fallback_exc:
            await record_queue_incident(
                provider="celery",
                incident_type="metadata_probe_failed",
                queue_name="metadata_worker",
                job_id=probe_job_id,
                runner="local_async",
                detail=str(fallback_exc),
            )
            await update_job(probe_job_id, status="failed", error=str(fallback_exc), code=fallback_exc.code, progress=100)
            await add_job_event(probe_job_id, "failed", {"code": fallback_exc.code, "error": str(fallback_exc)})
            raise
        except Exception as fallback_exc:
            await record_queue_incident(
                provider="celery",
                incident_type="metadata_probe_failed",
                queue_name="metadata_worker",
                job_id=probe_job_id,
                runner="local_async",
                detail=str(fallback_exc),
            )
            await update_job(probe_job_id, status="failed", error="Extraction failed", code="extraction_failed", progress=100)
            await add_job_event(probe_job_id, "failed", {"code": "extraction_failed", "error": str(fallback_exc)})
            raise


def _required_paid_lane_for_choice(choice: dict[str, object]) -> str | None:
    if not choice:
        return None

    if str(choice.get("type") or "").lower() == "video":
        height = int(choice.get("height") or 0)
        if height >= 2160:
            return "premium"
        if height > 720:
            return "pro"

    return None


async def _enforce_paid_extraction_lane(user: dict, choice: dict[str, object]) -> dict:
    required_plan = _required_paid_lane_for_choice(choice)
    if not required_plan:
        return user

    if user.get("is_owner"):
        return user

    user_id = str(user.get("id") or "").strip()
    lane_label = "Ultra" if required_plan == "premium" else "Pro"
    if not user_id:
        log.warning("Subscription Required: anonymous request blocked for %s lane extraction", lane_label)
        raise HTTPException(
            status_code=403,
            detail=f"{lane_label} extraction requires an active paid subscription.",
        )

    subscription = await asyncio.to_thread(payments.get_active_paid_subscription, user_id)
    if not payments.subscription_satisfies_required_plan(subscription, required_plan):
        log.warning(
            "Subscription Required: user %s blocked for %s lane extraction",
            user_id,
            lane_label,
        )
        raise HTTPException(
            status_code=403,
            detail=f"{lane_label} extraction requires an active paid subscription.",
        )

    refreshed_user = dict(user)
    refreshed_user["subscription"] = subscription
    refreshed_user["plan"] = subscription.get("plan_code") or user.get("plan") or "free"
    refreshed_user["entitlement"] = build_effective_entitlement(refreshed_user)
    return refreshed_user


async def _refresh_user_from_subscription_truth(user: dict) -> dict:
    if user.get("is_owner") or user.get("anonymous"):
        return user

    user_id = str(user.get("id") or "").strip()
    if not user_id:
        return user

    subscription = await asyncio.to_thread(payments.get_active_paid_subscription, user_id)
    if not subscription:
        return user

    refreshed_user = dict(user)
    refreshed_user["subscription"] = subscription
    refreshed_user["plan"] = subscription.get("plan_code") or user.get("plan") or "free"
    refreshed_user["entitlement"] = build_effective_entitlement(refreshed_user)
    return refreshed_user


async def _enforce_runtime_dispatch_controls(user: dict, route_label: str) -> None:
    if user.get("is_owner"):
        return

    controls = await get_runtime_ops_state()
    user_id = str(user.get("id") or "anonymous")

    if controls.get("maintenance_mode"):
        log.warning("Maintenance Mode: blocked %s for user %s", route_label, user_id)
        raise HTTPException(
            status_code=503,
            detail="Maintenance mode is active. New extraction jobs are temporarily paused.",
        )

    if controls.get("queue_drain_mode"):
        log.warning("Queue Drain: blocked %s for user %s", route_label, user_id)
        raise HTTPException(
            status_code=503,
            detail="Queue drain mode is active. New extraction jobs are temporarily paused.",
        )


@app.on_event("startup")
async def startup_event():
    global FALLBACK_CLEANUP_TASK, VAULT_HISTORY_ROLLUP_TASK, REVENUE_ROLLUP_TASK, AUDIT_ROLLUP_TASK, SUBSCRIPTION_ROLLUP_TASK, BILLING_RECONCILIATION_TASK, ABUSE_ROLLUP_TASK, PROXY_ROLLUP_TASK, PROXY_ALERT_ROLLUP_TASK, PROXY_BREAKER_POSTURE_ROLLUP_TASK, PROXY_ALERT_SNAPSHOT_TASK, PROXY_AUTO_RECOVERY_TASK, PROXY_CIRCUIT_BREAKER_TASK
    await load_redis_ledger_functions()
    ensure_media_binaries()
    cleanup_expired_local_artifacts()
    if not USE_CELERY_BEAT_SCHEDULER and (FALLBACK_CLEANUP_TASK is None or FALLBACK_CLEANUP_TASK.done()):
        FALLBACK_CLEANUP_TASK = asyncio.create_task(_fallback_cleanup_loop())
    try:
        await refresh_history_rollups_best_effort()
    except Exception as exc:
        log.warning("Initial vault history rollup refresh skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (VAULT_HISTORY_ROLLUP_TASK is None or VAULT_HISTORY_ROLLUP_TASK.done()):
        VAULT_HISTORY_ROLLUP_TASK = asyncio.create_task(_vault_history_rollup_loop())
    try:
        await refresh_revenue_rollups_best_effort()
    except Exception as exc:
        log.warning("Initial revenue rollup refresh skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (REVENUE_ROLLUP_TASK is None or REVENUE_ROLLUP_TASK.done()):
        REVENUE_ROLLUP_TASK = asyncio.create_task(_revenue_rollup_loop())
    try:
        await refresh_audit_rollups_best_effort()
    except Exception as exc:
        log.warning("Initial audit rollup refresh skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (AUDIT_ROLLUP_TASK is None or AUDIT_ROLLUP_TASK.done()):
        AUDIT_ROLLUP_TASK = asyncio.create_task(_audit_rollup_loop())
    try:
        await refresh_subscription_rollups_best_effort()
    except Exception as exc:
        log.warning("Initial subscription rollup refresh skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (SUBSCRIPTION_ROLLUP_TASK is None or SUBSCRIPTION_ROLLUP_TASK.done()):
        SUBSCRIPTION_ROLLUP_TASK = asyncio.create_task(_subscription_rollup_loop())

    try:
        await refresh_billing_reconciliation_best_effort()
    except Exception as exc:
        log.warning("Initial billing reconciliation skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (BILLING_RECONCILIATION_TASK is None or BILLING_RECONCILIATION_TASK.done()):
        BILLING_RECONCILIATION_TASK = asyncio.create_task(_billing_reconciliation_loop())
    try:
        await refresh_abuse_rollups_best_effort()
    except Exception as exc:
        log.warning("Initial abuse rollup refresh skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (ABUSE_ROLLUP_TASK is None or ABUSE_ROLLUP_TASK.done()):
        ABUSE_ROLLUP_TASK = asyncio.create_task(_abuse_rollup_loop())
    try:
        await refresh_proxy_rollups_best_effort()
    except Exception as exc:
        log.warning("Initial proxy rollup flush skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (PROXY_ROLLUP_TASK is None or PROXY_ROLLUP_TASK.done()):
        PROXY_ROLLUP_TASK = asyncio.create_task(_proxy_rollup_loop())
    try:
        await refresh_proxy_alert_rollups_best_effort()
    except Exception as exc:
        log.warning("Initial proxy breaker rollup refresh skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (PROXY_ALERT_ROLLUP_TASK is None or PROXY_ALERT_ROLLUP_TASK.done()):
        PROXY_ALERT_ROLLUP_TASK = asyncio.create_task(_proxy_alert_rollup_loop())
    try:
        await refresh_proxy_breaker_posture_rollups_best_effort()
    except Exception as exc:
        log.warning("Initial proxy breaker posture rollup refresh skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (PROXY_BREAKER_POSTURE_ROLLUP_TASK is None or PROXY_BREAKER_POSTURE_ROLLUP_TASK.done()):
        PROXY_BREAKER_POSTURE_ROLLUP_TASK = asyncio.create_task(_proxy_breaker_posture_rollup_loop())
    try:
        await refresh_proxy_alert_snapshots_best_effort()
    except Exception as exc:
        log.warning("Initial proxy alert snapshot refresh skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (PROXY_ALERT_SNAPSHOT_TASK is None or PROXY_ALERT_SNAPSHOT_TASK.done()):
        PROXY_ALERT_SNAPSHOT_TASK = asyncio.create_task(_proxy_alert_snapshot_loop())
    try:
        await asyncio.to_thread(probe_paused_providers)
    except Exception as exc:
        log.warning("Initial proxy auto-recovery probe skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (PROXY_AUTO_RECOVERY_TASK is None or PROXY_AUTO_RECOVERY_TASK.done()):
        PROXY_AUTO_RECOVERY_TASK = asyncio.create_task(_proxy_auto_recovery_loop())
    try:
        await asyncio.to_thread(enforce_circuit_breakers)
    except Exception as exc:
        log.warning("Initial proxy circuit breaker evaluation skipped: %s", exc)
    if not USE_CELERY_BEAT_SCHEDULER and (PROXY_CIRCUIT_BREAKER_TASK is None or PROXY_CIRCUIT_BREAKER_TASK.done()):
        PROXY_CIRCUIT_BREAKER_TASK = asyncio.create_task(_proxy_circuit_breaker_loop())
    if USE_CELERY_BEAT_SCHEDULER:
        log.info("Celery Beat scheduler is enabled; inline backend ops loops are disabled.")


@app.on_event("shutdown")
async def shutdown_event():
    global FALLBACK_CLEANUP_TASK, VAULT_HISTORY_ROLLUP_TASK, REVENUE_ROLLUP_TASK, AUDIT_ROLLUP_TASK, SUBSCRIPTION_ROLLUP_TASK, BILLING_RECONCILIATION_TASK, ABUSE_ROLLUP_TASK, PROXY_ROLLUP_TASK, PROXY_ALERT_ROLLUP_TASK, PROXY_BREAKER_POSTURE_ROLLUP_TASK, PROXY_ALERT_SNAPSHOT_TASK, PROXY_AUTO_RECOVERY_TASK, PROXY_CIRCUIT_BREAKER_TASK
    if FALLBACK_CLEANUP_TASK:
        FALLBACK_CLEANUP_TASK.cancel()
        try:
            await FALLBACK_CLEANUP_TASK
        except asyncio.CancelledError:
            pass
        FALLBACK_CLEANUP_TASK = None
    if VAULT_HISTORY_ROLLUP_TASK:
        VAULT_HISTORY_ROLLUP_TASK.cancel()
        try:
            await VAULT_HISTORY_ROLLUP_TASK
        except asyncio.CancelledError:
            pass
        VAULT_HISTORY_ROLLUP_TASK = None
    if REVENUE_ROLLUP_TASK:
        REVENUE_ROLLUP_TASK.cancel()
        try:
            await REVENUE_ROLLUP_TASK
        except asyncio.CancelledError:
            pass
        REVENUE_ROLLUP_TASK = None
    if AUDIT_ROLLUP_TASK:
        AUDIT_ROLLUP_TASK.cancel()
        try:
            await AUDIT_ROLLUP_TASK
        except asyncio.CancelledError:
            pass
        AUDIT_ROLLUP_TASK = None
    if SUBSCRIPTION_ROLLUP_TASK:
        SUBSCRIPTION_ROLLUP_TASK.cancel()
        try:
            await SUBSCRIPTION_ROLLUP_TASK
        except asyncio.CancelledError:
            pass
        SUBSCRIPTION_ROLLUP_TASK = None

    if BILLING_RECONCILIATION_TASK:
        BILLING_RECONCILIATION_TASK.cancel()
        try:
            await BILLING_RECONCILIATION_TASK
        except asyncio.CancelledError:
            pass
        BILLING_RECONCILIATION_TASK = None
    if ABUSE_ROLLUP_TASK:
        ABUSE_ROLLUP_TASK.cancel()
        try:
            await ABUSE_ROLLUP_TASK
        except asyncio.CancelledError:
            pass
        ABUSE_ROLLUP_TASK = None
    if PROXY_ROLLUP_TASK:
        PROXY_ROLLUP_TASK.cancel()
        try:
            await PROXY_ROLLUP_TASK
        except asyncio.CancelledError:
            pass
        PROXY_ROLLUP_TASK = None
    if PROXY_ALERT_ROLLUP_TASK:
        PROXY_ALERT_ROLLUP_TASK.cancel()
        try:
            await PROXY_ALERT_ROLLUP_TASK
        except asyncio.CancelledError:
            pass
        PROXY_ALERT_ROLLUP_TASK = None
    if PROXY_BREAKER_POSTURE_ROLLUP_TASK:
        PROXY_BREAKER_POSTURE_ROLLUP_TASK.cancel()
        try:
            await PROXY_BREAKER_POSTURE_ROLLUP_TASK
        except asyncio.CancelledError:
            pass
        PROXY_BREAKER_POSTURE_ROLLUP_TASK = None
    if PROXY_ALERT_SNAPSHOT_TASK:
        PROXY_ALERT_SNAPSHOT_TASK.cancel()
        try:
            await PROXY_ALERT_SNAPSHOT_TASK
        except asyncio.CancelledError:
            pass
        PROXY_ALERT_SNAPSHOT_TASK = None
    if PROXY_AUTO_RECOVERY_TASK:
        PROXY_AUTO_RECOVERY_TASK.cancel()
        try:
            await PROXY_AUTO_RECOVERY_TASK
        except asyncio.CancelledError:
            pass
        PROXY_AUTO_RECOVERY_TASK = None
    if PROXY_CIRCUIT_BREAKER_TASK:
        PROXY_CIRCUIT_BREAKER_TASK.cancel()
        try:
            await PROXY_CIRCUIT_BREAKER_TASK
        except asyncio.CancelledError:
            pass
        PROXY_CIRCUIT_BREAKER_TASK = None


@app.post("/extract")
@app.post("/api/extract")
async def extract_route(
    payload: ExtractRequest,
    request: Request,
    unkey_data: dict = Depends(verify_unkey_token),
    user: dict = Depends(get_current_user),
) -> dict:
    url = _validate_media_url(payload.url)
    await enforce_consumer_rate_limit(request, user, "extract", limit=15, window_seconds=60)
    await _enforce_runtime_dispatch_controls(user, "extract")

    try:
        return await asyncio.wait_for(_run_extract_probe(url, user), timeout=70.0)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=408, detail="Extraction timed out")
    except MediaExtractionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        log.error("Extraction failure: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Extraction failed")


@app.post("/download")
@app.post("/api/download")
@app.post("/api/download-job")
async def start_download(
    payload: DownloadRequest,
    request: Request,
    unkey_data: dict = Depends(verify_unkey_token),
    user: dict = Depends(get_current_user),
) -> dict:
    payload.url = _validate_media_url(payload.url)
    await enforce_consumer_rate_limit(request, user, "download", limit=5, window_seconds=60)
    user = await _refresh_user_from_subscription_truth(user)
    await _enforce_runtime_dispatch_controls(user, "download")

    info = await asyncio.to_thread(lambda: extract_media_info(payload.url, lightweight_probe=True))
    entitlement = user.get("entitlement") or build_effective_entitlement(user)
    include_owner_formats = bool(entitlement.get("4k_allowed") or user.get("is_owner"))
    catalog = build_format_catalog(info, include_owner_formats=include_owner_formats)
    choice = find_format_option(catalog, payload.format_id, raw_info=info)
    if not choice:
        available_ids = [str(item.get("format_id")) for item in catalog]
        raise HTTPException(
            status_code=422,
            detail=f"Requested format '{payload.format_id}' is not available. Available formats: {', '.join(available_ids[:10])}",
        )
    user = await _enforce_paid_extraction_lane(user, choice)
    entitlement = user.get("entitlement") or build_effective_entitlement(user)

    if payload.delivery_target == "telegram" and choice.get("filesize", 0) > MAX_TELEGRAM_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Use website download.")
    if payload.delivery_target == "discord" and choice.get("filesize", 0) > MAX_DISCORD_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Use website download.")

    if not user.get("anonymous") and user.get("id"):
        usage_res = await check_user_limit(user)
        if usage_res.get("limit_exceeded"):
            from backend.auth import get_tiered_limit_reached_message
            raise HTTPException(
                status_code=429,
                detail=get_tiered_limit_reached_message(user),
            )

    job_id = secrets.token_urlsafe(16)
    queue_name = str(entitlement.get("queue_priority") or "free_consumer")
    provider = get_provider_capability(payload.url).get("provider")

    # Concurrency guard: if an identical download for this user is already in
    # flight, return that job instead of queuing a redundant one. Refund the
    # credit this duplicate request reserved in the gate middleware, since we
    # are doing no additional work.
    duplicate_job_id = await claim_or_find_active_download(
        user.get("id"), payload.url, payload.format_id, job_id
    )
    if duplicate_job_id:
        mw_job_id = getattr(request.state, "job_id", None)
        if mw_job_id and user.get("id") and not user.get("anonymous"):
            from backend.middleware.credit_gate import refund_credits
            await refund_credits(user.get("id"), mw_job_id, cost=1)
        return {
            "job_id": duplicate_job_id,
            "status": "queued",
            "queue_name": queue_name,
            "runner": "deduplicated",
            "deduplicated": True,
        }

    await register_job(
        job_id,
        {
            "user_id": user.get("id"),
            "source_channel": payload.delivery_target,
            "provider": provider,
            "normalized_url": payload.url,
            "requested_format_id": payload.format_id,
            "requested_media_type": payload.format_type,
            "queue_name": queue_name,
            "priority": queue_name,
            "status": "queued",
            "progress": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    await _store_job(job_id, status="queued", progress=0, error=None)
    await add_job_event(job_id, "queued", {"queue_name": queue_name})

    payload_dict = payload.model_dump()
    payload_dict["download_selector"] = choice["download_selector"]
    payload_dict["resolved_title"] = info.get("title")
    payload_dict["provider"] = provider
    if USE_CELERY_DOWNLOADS:
        try:
            result = download_delivery_task.delay(job_id, payload_dict, user)
            await _store_job(job_id, celery_task_id=result.id)
            return {"job_id": job_id, "status": "queued", "queue_name": queue_name, "runner": "celery", "celery_task_id": result.id}
        except Exception as exc:
            await record_queue_incident(
                provider="celery",
                incident_type="download_dispatch_failed",
                queue_name=queue_name,
                job_id=job_id,
                runner="celery",
                detail=str(exc),
            )
            await add_job_event(job_id, "dispatch_fallback_local", {"error": str(exc), "queue_name": queue_name})
            await _store_job(job_id, runner="local_async", error="Celery dispatch fallback activated", code="dispatch_fallback")
            asyncio.create_task(run_download_job_async(job_id, payload_dict, user))
            return {"job_id": job_id, "status": "queued", "queue_name": queue_name, "runner": "local_async"}

    asyncio.create_task(run_download_job_async(job_id, payload_dict, user))
    return {"job_id": job_id, "status": "queued", "queue_name": queue_name, "runner": "local_async"}


@app.get("/progress/{job_id}")
@app.get("/api/progress/{job_id}")
async def download_progress(job_id: str) -> dict:
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "job_id": job_id,
        "status": job.get("status", "unknown"),
        "progress": job.get("progress", 0),
        "speed": job.get("speed"),
        "eta": job.get("eta"),
        "error": job.get("error"),
        "error_code": job.get("code"),
        "error_status_code": job.get("error_status_code"),
        "download_url": job.get("download_url"),
        "fallback_url": job.get("fallback_url"),
        "delivery_mode": job.get("delivery_mode"),
        "expires_at": job.get("expires_at"),
        "filename": job.get("filename"),
        "size_bytes": job.get("size_bytes"),
    }


@app.get("/download/file/{job_id}")
@app.get("/api/download/file/{job_id}")
async def download_file(job_id: str) -> FileResponse:
    job = await get_job(job_id)
    if not job or job.get("status") != "completed" or not job.get("path"):
        raise HTTPException(status_code=404, detail="Download not ready")

    path = job["path"]
    temp_dir = job.get("temp_dir")
    filename = job.get("filename") or Path(path).name
    media_type = "video/mp4" if filename.lower().endswith(".mp4") else "application/octet-stream"
    return FileResponse(
        path=path,
        filename=filename,
        media_type=media_type,
        background=BackgroundTask(_cleanup_temp, temp_dir),
    )


@app.get("/api/fallback/{token}")
async def signed_fallback_download(token: str) -> FileResponse:
    artifact_stats = get_local_artifact_stats()
    if not artifact_stats.get("registry_available"):
        raise HTTPException(status_code=503, detail="Fallback registry is unavailable.")
    payload = resolve_local_artifact(token)
    if not payload:
        raise HTTPException(status_code=404, detail="Fallback artifact not found or expired.")

    path = payload["path"]
    filename = payload.get("filename") or Path(path).name
    lowered = filename.lower()
    if lowered.endswith(".mp4"):
        media_type = "video/mp4"
    elif lowered.endswith(".mp3"):
        media_type = "audio/mpeg"
    elif lowered.endswith(".m4a"):
        media_type = "audio/mp4"
    else:
        media_type = "application/octet-stream"

    return FileResponse(path=path, filename=filename, media_type=media_type)


@app.get("/info")
@app.get("/api/info")
async def info_alias(
    request: Request,
    url: str = Query(..., min_length=10, max_length=2048),
    unkey_data: dict = Depends(verify_unkey_token),
    user: dict = Depends(get_current_user),
) -> dict:
    return await extract_route(ExtractRequest(url=url), request, unkey_data, user)


@app.get("/api/download")
async def direct_download_alias(
    request: Request,
    url: str = Query(..., min_length=10, max_length=2048),
    format_id: str = Query(..., min_length=1, max_length=100),
    format_type: str = Query("video"),
    filename: Optional[str] = Query(None),
    delivery_target: str = Query("web"),
    unkey_data: dict = Depends(verify_unkey_token),
    user: dict = Depends(get_current_user),
):
    payload = DownloadRequest(
        url=_validate_media_url(url),
        format_id=format_id,
        format_type=format_type,
        filename=filename,
        delivery_target=delivery_target,
    )
    await enforce_consumer_rate_limit(request, user, "download", limit=5, window_seconds=60)
    user = await _refresh_user_from_subscription_truth(user)
    await _enforce_runtime_dispatch_controls(user, "direct_download")

    info = await asyncio.to_thread(lambda: extract_media_info(payload.url, lightweight_probe=True))
    entitlement = user.get("entitlement") or build_effective_entitlement(user)
    include_owner_formats = bool(entitlement.get("4k_allowed") or user.get("is_owner"))
    catalog = build_format_catalog(info, include_owner_formats=include_owner_formats)
    choice = find_format_option(catalog, payload.format_id, raw_info=info)
    if not choice:
        raise HTTPException(status_code=422, detail=f"Requested format '{payload.format_id}' is not available.")
    user = await _enforce_paid_extraction_lane(user, choice)

    if payload.delivery_target == "telegram" and choice.get("filesize", 0) > MAX_TELEGRAM_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Use website download.")
    if payload.delivery_target == "discord" and choice.get("filesize", 0) > MAX_DISCORD_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Use website download.")

    if not user.get("anonymous") and user.get("id"):
        usage_res = await check_user_limit(user)
        if usage_res.get("limit_exceeded"):
            from backend.auth import get_tiered_limit_reached_message
            raise HTTPException(
                status_code=429,
                detail=get_tiered_limit_reached_message(user),
            )

    temp_dir, output_template = create_temp_output(payload.filename or info.get("title") or "download")

    try:
        output_path = await download_selected_media(
            url=payload.url,
            selector=choice["download_selector"],
            format_type=payload.format_type,
            output_template=output_template,
            info=info,
        )
        media_type = "video/mp4" if output_path.suffix.lower() == ".mp4" else "application/octet-stream"

        if not user.get("anonymous") and user.get("id"):
            from backend.auth import increment_user_download_count
            await increment_user_download_count(user.get("id"))

        return FileResponse(
            path=output_path,
            filename=output_path.name,
            media_type=media_type,
            background=BackgroundTask(_cleanup_temp, temp_dir),
        )
    except MediaExtractionError as exc:
        _cleanup_temp(temp_dir)
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    except Exception as exc:
        _cleanup_temp(temp_dir)
        log.error("Direct API download failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Download failed")


@app.get("/api/proxy-image")
@limiter.limit("120/minute")
async def proxy_image(request: Request, url: str = Query(...)):
    try:
        def fetch_img():
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"},
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.read(), response.info().get_content_type()

        data, content_type = await asyncio.get_event_loop().run_in_executor(None, fetch_img)
        return Response(content=data, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})
    except Exception as exc:
        log.error("Image proxy failed for %s: %s", url, exc)
        raise HTTPException(status_code=404, detail="Image not found")


@app.get("/api/provider-capability")
async def provider_capability(url: str = Query(..., min_length=10, max_length=2048)) -> dict:
    normalized = normalize_media_url(url)
    return get_provider_capability(normalized)


@app.get("/api/campaign/current")
async def current_campaign() -> dict:
    snapshot = await get_campaign_snapshot()
    return {
        "active_message": snapshot.get("active_message") or "",
        "limit": snapshot.get("limit") or {
            "free": DEFAULT_FREE_LIMIT,
            "pro": DEFAULT_PRO_LIMIT,
        },
        "quality": snapshot.get("quality") or {
            "free": list(DEFAULT_FREE_QUALITIES),
            "pro": list(DEFAULT_PRO_QUALITIES),
        },
        "updated_at": snapshot.get("updated_at"),
        "updated_by": snapshot.get("updated_by"),
        "redis_available": bool(snapshot.get("redis_available")),
    }


@app.get("/api/pricing/current")
async def current_pricing() -> dict:
    snapshot = await get_pricing_snapshot()
    return {
        "elite_monthly": snapshot.get("elite_monthly") or {
            "base": DEFAULT_ELITE_BASE,
            "current": DEFAULT_ELITE_CURRENT,
            "minimum_threshold": MIN_ELITE_THRESHOLD,
            "currency_code": "INR",
        },
        "sale": snapshot.get("sale") or {
            "is_active": False,
            "message": "",
            "end_timestamp": None,
        },
        "preview": {
            "inr": pricing_preview_charge_inr(snapshot),
            "usd_cents": pricing_preview_charge_usd_cents(snapshot),
        },
        "updated_at": snapshot.get("updated_at"),
        "updated_by": snapshot.get("updated_by"),
        "redis_available": bool(snapshot.get("redis_available")),
    }


@app.post("/api/checkout/create-session")
async def checkout_create_session_alias(
    payload: payments.CreateCheckoutSessionPayload,
    user: dict = Depends(get_current_user),
):
    return await payments.create_checkout_session(payload, user)


@app.get("/api/admin/config")
async def admin_campaign_config(user: dict = Depends(_require_campaign_admin)) -> dict:
    snapshot = await get_campaign_snapshot(include_overrides=True)
    pricing_snapshot = await get_pricing_snapshot()
    return {
        "active_message": snapshot.get("active_message") or "",
        "limit": snapshot.get("limit") or {
            "free": DEFAULT_FREE_LIMIT,
            "pro": DEFAULT_PRO_LIMIT,
        },
        "quality": snapshot.get("quality") or {
            "free": list(DEFAULT_FREE_QUALITIES),
            "pro": list(DEFAULT_PRO_QUALITIES),
        },
        "overrides": snapshot.get("overrides") or [],
        "updated_at": snapshot.get("updated_at"),
        "updated_by": snapshot.get("updated_by"),
        "redis_available": bool(snapshot.get("redis_available")),
        "pricing": {
            "elite_monthly": pricing_snapshot.get("elite_monthly") or {
                "base": DEFAULT_ELITE_BASE,
                "current": DEFAULT_ELITE_CURRENT,
                "minimum_threshold": MIN_ELITE_THRESHOLD,
                "currency_code": "INR",
            },
            "sale": pricing_snapshot.get("sale") or {
                "is_active": False,
                "message": "",
                "end_timestamp": None,
            },
            "preview": {
                "inr": pricing_preview_charge_inr(pricing_snapshot),
                "usd_cents": pricing_preview_charge_usd_cents(pricing_snapshot),
            },
            "updated_at": pricing_snapshot.get("updated_at"),
            "updated_by": pricing_snapshot.get("updated_by"),
            "redis_available": bool(pricing_snapshot.get("redis_available")),
        },
    }


@app.post("/api/admin/config")
async def update_admin_campaign_config(
    payload: CampaignConfigPayload,
    user: dict = Depends(_require_campaign_admin),
) -> dict:
    if (
        payload.active_message is None
        and payload.limit is None
        and payload.quality is None
        and payload.override is None
        and payload.pricing is None
    ):
        raise HTTPException(status_code=400, detail="No campaign updates provided.")

    if payload.active_message is not None or payload.limit is not None or payload.quality is not None:
        await update_campaign_settings(
            active_message=payload.active_message,
            free_limit=payload.limit.free if payload.limit else None,
            pro_limit=payload.limit.pro if payload.limit else None,
            free_qualities=payload.quality.free if payload.quality else None,
            pro_qualities=payload.quality.pro if payload.quality else None,
            actor_user_id=str(user.get("id") or user.get("email") or "") or None,
        )

    if payload.override is not None:
        await set_user_override(
            payload.override.user_id,
            limit=payload.override.limit,
            quality=payload.override.quality,
            remove=payload.override.remove,
        )

    if payload.pricing is not None:
        pricing_update_kwargs: dict[str, object | None] = {
            "actor_user_id": str(user.get("id") or user.get("email") or "") or None,
        }
        if payload.pricing.elite_monthly is not None:
            pricing_update_kwargs["elite_monthly_base"] = payload.pricing.elite_monthly.base
            pricing_update_kwargs["elite_monthly_current"] = payload.pricing.elite_monthly.current
        if payload.pricing.sale is not None:
            pricing_update_kwargs["sale_is_active"] = payload.pricing.sale.is_active
            pricing_update_kwargs["sale_message"] = payload.pricing.sale.message
            pricing_update_kwargs["sale_end_timestamp"] = payload.pricing.sale.end_timestamp

        await update_pricing_settings(**pricing_update_kwargs)

    snapshot = await get_campaign_snapshot(include_overrides=True)
    pricing_snapshot = await get_pricing_snapshot()
    return {
        "status": "updated",
        "config": {
            "active_message": snapshot.get("active_message") or "",
            "limit": snapshot.get("limit") or {
                "free": DEFAULT_FREE_LIMIT,
                "pro": DEFAULT_PRO_LIMIT,
            },
            "quality": snapshot.get("quality") or {
                "free": list(DEFAULT_FREE_QUALITIES),
                "pro": list(DEFAULT_PRO_QUALITIES),
            },
            "overrides": snapshot.get("overrides") or [],
            "updated_at": snapshot.get("updated_at"),
            "updated_by": snapshot.get("updated_by"),
            "redis_available": bool(snapshot.get("redis_available")),
            "pricing": {
                "elite_monthly": pricing_snapshot.get("elite_monthly") or {
                    "base": DEFAULT_ELITE_BASE,
                    "current": DEFAULT_ELITE_CURRENT,
                    "minimum_threshold": MIN_ELITE_THRESHOLD,
                    "currency_code": "INR",
                },
                "sale": pricing_snapshot.get("sale") or {
                    "is_active": False,
                    "message": "",
                    "end_timestamp": None,
                },
                "preview": {
                    "inr": pricing_preview_charge_inr(pricing_snapshot),
                    "usd_cents": pricing_preview_charge_usd_cents(pricing_snapshot),
                },
                "updated_at": pricing_snapshot.get("updated_at"),
                "updated_by": pricing_snapshot.get("updated_by"),
                "redis_available": bool(pricing_snapshot.get("redis_available")),
            },
        },
    }


@app.get("/api/account/me")
async def account_me(user: dict = Depends(get_current_user)) -> dict:
    if user.get("anonymous"):
        raise HTTPException(status_code=401, detail="Authentication required.")

    # Fetch live usage count from Redis to display in the frontend dashboard
    from backend.api_v1.middleware import _get_redis_client
    redis_client = _get_redis_client()
    downloads_today = 0
    api_requests_today = 0
    if redis_client is not None:
        try:
            usage_key = f"download_usage_buffer:{user.get('id')}"
            val = await redis_client.get(usage_key)
            if val:
                downloads_today = int(val)
        except Exception:
            pass

        try:
            api_usage_key = f"api_usage_daily:{user.get('id')}"
            api_val = await redis_client.get(api_usage_key)
            if api_val:
                api_requests_today = int(api_val)
        except Exception:
            pass

    entitlement = user.get("entitlement") or build_effective_entitlement(user)
    return {
        "id": user.get("id"),
        "email": user.get("email"),
        "plan": user.get("plan") or "free",
        "role": user.get("role") or "user",
        "downloads_today": downloads_today,
        "api_requests_today": api_requests_today,
        "account_status": user.get("account_status") or "active",
        "subscription": user.get("subscription"),
        "entitlement": {
            "download_limit_daily": entitlement.get("download_limit_daily"),
            "api_request_limit_daily": entitlement.get("api_request_limit_daily"),
            "max_quality": entitlement.get("max_quality"),
            "audio_limit": entitlement.get("audio_limit"),
            "retention_hours": entitlement.get("retention_hours"),
            "history_enabled": entitlement.get("history_enabled"),
            "4k_allowed": entitlement.get("4k_allowed"),
            "api_enabled": entitlement.get("api_enabled"),
        },
    }


@app.get("/api/health")
async def health() -> dict:
    expired_cleaned = cleanup_expired_local_artifacts()
    job_summary = await summarize_jobs()
    artifact_stats = get_local_artifact_stats()
    proxy_telemetry = get_proxy_telemetry()
    return {
        "status": "ok",
        "service": "media-extractor",
        "jobs_total": job_summary["total_jobs"],
        "jobs_active": job_summary["active_jobs"],
        "expired_fallbacks_cleaned": expired_cleaned,
        "fallback_artifacts": artifact_stats,
        "fallback_cleanup_interval_seconds": FALLBACK_CLEANUP_INTERVAL_SECONDS,
        "vault_history_rollup_interval_seconds": VAULT_HISTORY_ROLLUP_INTERVAL_SECONDS,
        "revenue_rollup_interval_seconds": REVENUE_ROLLUP_INTERVAL_SECONDS,
        "audit_rollup_interval_seconds": AUDIT_ROLLUP_INTERVAL_SECONDS,
        "subscription_rollup_interval_seconds": SUBSCRIPTION_ROLLUP_INTERVAL_SECONDS,
        "billing_reconciliation_interval_seconds": BILLING_RECONCILIATION_INTERVAL_SECONDS,
        "abuse_rollup_interval_seconds": ABUSE_ROLLUP_INTERVAL_SECONDS,
        "proxy_rollup_flush_interval_seconds": PROXY_ROLLUP_FLUSH_INTERVAL_SECONDS,
        "proxy_alert_rollup_interval_seconds": PROXY_ALERT_ROLLUP_INTERVAL_SECONDS,
        "proxy_breaker_posture_rollup_interval_seconds": PROXY_BREAKER_POSTURE_ROLLUP_INTERVAL_SECONDS,
        "proxy_alert_snapshot_interval_seconds": PROXY_ALERT_SNAPSHOT_INTERVAL_SECONDS,
        "proxy_auto_recovery_poll_interval_seconds": PROXY_AUTO_RECOVERY_POLL_INTERVAL_SECONDS,
        "proxy_circuit_breaker_watchdog_seconds": PROXY_CIRCUIT_BREAKER_WATCHDOG_SECONDS,
        "proxy_telemetry": proxy_telemetry,
    }


@app.get("/metrics")
async def metrics() -> Response:
    try:
        from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
        from backend.api_v1.middleware import ensure_redis_or_fail
        
        redis_client = await ensure_redis_or_fail()
        if redis_client:
            # 1. Update Celery Task Success Metrics from Redis
            async for key in redis_client.scan_iter("metrics:tasks:success:*"):
                task_name = key.decode("utf-8").replace("metrics:tasks:success:", "") if isinstance(key, bytes) else key.replace("metrics:tasks:success:", "")
                val = await redis_client.get(key)
                if val:
                    NEXUS_CELERY_TASKS_SUCCESS_TOTAL.labels(task_name=task_name).set(float(val))

            # 2. Update Celery Task Failure Metrics from Redis
            async for key in redis_client.scan_iter("metrics:tasks:failure:*"):
                task_name = key.decode("utf-8").replace("metrics:tasks:failure:", "") if isinstance(key, bytes) else key.replace("metrics:tasks:failure:", "")
                val = await redis_client.get(key)
                if val:
                    NEXUS_CELERY_TASKS_FAILURE_TOTAL.labels(task_name=task_name).set(float(val))
    except Exception as exc:
        log.warning("Failed updating Prometheus gauges from Redis: %s", exc)

    try:
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
    except Exception as exc:
        return Response(content=f"# Metrics error: {str(exc)}", media_type="text/plain")
