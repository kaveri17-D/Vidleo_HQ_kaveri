from __future__ import annotations

import asyncio
import collections
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
try:
    import redis
except Exception:  # pragma: no cover - optional during partial local setups
    redis = None
try:
    import yt_dlp
except Exception:  # pragma: no cover - optional during partial local setups
    yt_dlp = None

from backend.format_parser import get_formats as build_formats_payload
from backend.media_url import normalize_media_url
from backend.proxy_state import (
    acquire_youtube_proxy,
    get_metadata_proxy_url,
    mark_proxy_burned,
    record_proxy_probe,
    record_youtube_proxy_result,
)
from backend.cookie_vault import (
    acquire_vault_cookie_file,
    record_cookie_result,
    cleanup_vault_cookie_file,
)

log = logging.getLogger("nexus.extractor")

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env", override=False)

YT_DLP_BINARY = BACKEND_DIR / "bin" / "yt-dlp.exe"
FFMPEG_BINARY = BACKEND_DIR / "bin" / "ffmpeg.exe"
FFPROBE_BINARY = BACKEND_DIR / "bin" / "ffprobe.exe"
RUNTIME_TEMP_DIR = BACKEND_DIR / ".runtime" / "yt-dlp-temp"
RUNTIME_COOKIE_DIR = BACKEND_DIR / ".runtime" / "cookies"
CHROME_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/135.0.0.0 Safari/537.36"
)
CHROME_ACCEPT_LANGUAGE = "Accept-Language:en-US,en;q=0.9"
YOUTUBE_PO_TOKEN_SIDECAR_URL = os.environ.get(
    "YOUTUBE_PO_TOKEN_SIDECAR_URL",
    "http://po-token-sidecar:3000/generate",
).strip()
YOUTUBE_PO_TOKEN_TIMEOUT_SECONDS = 3.0

# ── Elite Concurrency Doctrine: Tuned for speed ─────────────────────────────
PROBE_CACHE_TTL_SECONDS = 3600  # 60 minutes shared Redis memoization
SUBPROCESS_TIMEOUT_SECONDS = 30  # Hard limit (was 60s) — fail fast
L1_CACHE_MAX_SIZE = int(os.environ.get("PROBE_L1_CACHE_MAX_SIZE", "500"))
PROBE_CACHE: collections.OrderedDict[str, dict[str, Any]] = collections.OrderedDict()
_PROBE_CACHE_CLIENT = None

# ── Elite Concurrency Doctrine: Persistent httpx Client (Keep-Alive Warming) ─
_PO_TOKEN_CLIENT: httpx.AsyncClient | None = None

RUNTIME_TEMP_DIR.mkdir(parents=True, exist_ok=True)
RUNTIME_COOKIE_DIR.mkdir(parents=True, exist_ok=True)

# ── Known provider patterns for lightweight capability checks ────────────────
_KNOWN_PROVIDERS: dict[str, re.Pattern] = {
    "youtube": re.compile(r"(youtube\.com|youtu\.be|music\.youtube\.com)", re.I),
    "vimeo": re.compile(r"vimeo\.com", re.I),
    "tiktok": re.compile(r"tiktok\.com", re.I),
    "instagram": re.compile(r"(instagram\.com|instagr\.am)", re.I),
    "twitter": re.compile(r"(twitter\.com|x\.com)", re.I),
    "dailymotion": re.compile(r"(dailymotion\.com|dai\.ly)", re.I),
    "facebook": re.compile(r"(facebook\.com|fb\.watch)", re.I),
    "reddit": re.compile(r"reddit\.com", re.I),
    "twitch": re.compile(r"twitch\.tv", re.I),
    "soundcloud": re.compile(r"soundcloud\.com", re.I),
    "bandcamp": re.compile(r"bandcamp\.com", re.I),
    "bilibili": re.compile(r"bilibili\.com", re.I),
}
_DRM_PROVIDERS = {"spotify.com", "netflix.com", "disneyplus.com", "hulu.com", "primevideo.com"}


class MediaExtractionError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 422, code: str = "extraction_failed") -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def _resolve_yt_dlp_binary() -> str | None:
    # Prioritize the system/pip-installed version (which gets updated nightly)
    system_ytdlp = shutil.which("yt-dlp")
    if system_ytdlp:
        return system_ytdlp
        
    # Fallback to local static binary if available (Windows only)
    if os.name == "nt" and YT_DLP_BINARY.exists():
        return str(YT_DLP_BINARY)
        
    return None


def _resolve_ffmpeg_binary() -> str | None:
    if os.name == "nt" and FFMPEG_BINARY.exists():
        return str(FFMPEG_BINARY)
    return shutil.which("ffmpeg")


def _resolve_ffprobe_binary() -> str | None:
    if os.name == "nt" and FFPROBE_BINARY.exists():
        return str(FFPROBE_BINARY)
    return shutil.which("ffprobe")


def _resolve_js_runtime() -> str | None:
    for runtime in ("node", "deno", "bun"):
        if shutil.which(runtime):
            return runtime
    return None


def resolve_ffmpeg_location() -> str | None:
    ffmpeg_path = _resolve_ffmpeg_binary()
    if not ffmpeg_path:
        return None
    return str(Path(ffmpeg_path).resolve().parent)


def ensure_media_binaries() -> None:
    yt_dlp_ok = _resolve_yt_dlp_binary()
    if not yt_dlp_ok:
        raise MediaExtractionError("yt-dlp binary is missing from backend/bin or PATH.", status_code=500, code="missing_ytdlp")

    ffmpeg_ok = _resolve_ffmpeg_binary()
    ffprobe_ok = _resolve_ffprobe_binary()
    if not ffmpeg_ok or not ffprobe_ok:
        raise MediaExtractionError(
            "ffmpeg/ffprobe is missing. Install ffmpeg or place ffmpeg.exe and ffprobe.exe in backend/bin.",
            status_code=500,
            code="missing_ffmpeg",
        )


def _build_subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    ffmpeg_location = resolve_ffmpeg_location()
    if ffmpeg_location:
        env["PATH"] = ffmpeg_location + os.pathsep + env.get("PATH", "")
    env["TEMP"] = str(RUNTIME_TEMP_DIR)
    env["TMP"] = str(RUNTIME_TEMP_DIR)
    return env


def _get_probe_cache_client():
    global _PROBE_CACHE_CLIENT
    if _PROBE_CACHE_CLIENT is False:
        return None
    if _PROBE_CACHE_CLIENT is not None:
        return _PROBE_CACHE_CLIENT
    redis_url = os.environ.get("REDIS_URL", "").strip()
    if not redis_url or redis is None:
        return None
    try:
        client = redis.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=0.2,
            socket_timeout=0.2,
            retry_on_timeout=False,
        )
        client.ping()
        _PROBE_CACHE_CLIENT = client
        return _PROBE_CACHE_CLIENT
    except Exception:
        _PROBE_CACHE_CLIENT = False
        return None


def _probe_cache_key(normalized_url: str) -> str:
    digest = hashlib.sha256(normalized_url.encode("utf-8")).hexdigest()
    return f"nexus:probe:v2:{digest}"


def _track_cache_metric(cache_client, *, hit: bool) -> None:
    """Elite Concurrency Doctrine: Atomic cache hit/miss tracking via Redis INCR."""
    if not cache_client:
        return
    try:
        key = "nexus:cache:hits" if hit else "nexus:cache:misses"
        cache_client.incr(key)
    except Exception:
        pass


def get_cache_hit_ratio() -> dict[str, Any]:
    """Returns live cache telemetry for monitoring and self-optimization."""
    cache_client = _get_probe_cache_client()
    result = {"hits": 0, "misses": 0, "ratio": 0.0, "l1_size": len(PROBE_CACHE)}
    if not cache_client:
        return result
    try:
        hits = int(cache_client.get("nexus:cache:hits") or 0)
        misses = int(cache_client.get("nexus:cache:misses") or 0)
        total = hits + misses
        result["hits"] = hits
        result["misses"] = misses
        result["ratio"] = round(hits / total, 4) if total > 0 else 0.0
    except Exception:
        pass
    return result


def _l1_cache_put(normalized_url: str, payload: dict[str, Any]) -> None:
    """Insert into bounded LRU L1 cache, evicting oldest entry when full."""
    if normalized_url in PROBE_CACHE:
        PROBE_CACHE.move_to_end(normalized_url)
    PROBE_CACHE[normalized_url] = {"created_at": time.time(), "payload": payload}
    while len(PROBE_CACHE) > L1_CACHE_MAX_SIZE:
        PROBE_CACHE.popitem(last=False)


def _get_probe_cache_payload(normalized_url: str) -> dict[str, Any] | None:
    cache_client = _get_probe_cache_client()
    # ── L1 in-memory check (sub-microsecond) ──
    cached = PROBE_CACHE.get(normalized_url)
    if cached and time.time() - cached["created_at"] <= PROBE_CACHE_TTL_SECONDS:
        PROBE_CACHE.move_to_end(normalized_url)  # refresh LRU position
        _track_cache_metric(cache_client, hit=True)
        return cached["payload"]

    # ── L2 Redis check ──
    if not cache_client:
        _track_cache_metric(cache_client, hit=False)
        return None

    try:
        raw = cache_client.get(_probe_cache_key(normalized_url))
    except Exception:
        _track_cache_metric(cache_client, hit=False)
        return None

    if not raw:
        _track_cache_metric(cache_client, hit=False)
        return None

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        _track_cache_metric(cache_client, hit=False)
        return None

    # Promote L2 hit to L1
    _l1_cache_put(normalized_url, payload)
    _track_cache_metric(cache_client, hit=True)
    return payload


def _set_probe_cache_payload(normalized_url: str, payload: dict[str, Any]) -> None:
    _l1_cache_put(normalized_url, payload)
    cache_client = _get_probe_cache_client()
    if not cache_client:
        return
    try:
        cache_client.setex(
            _probe_cache_key(normalized_url),
            PROBE_CACHE_TTL_SECONDS,
            json.dumps(payload, separators=(",", ":"), ensure_ascii=False),
        )
    except Exception:
        pass


def _resolve_cookies_file() -> str | None:
    """Return the configured cookies.txt path, resolving relative paths inside backend/."""
    env_path = os.environ.get("COOKIES_FILE", "").strip()
    if not env_path:
        return None

    candidate = Path(env_path)
    if not candidate.is_absolute():
        candidate = BACKEND_DIR / candidate
    if candidate.is_file():
        return str(candidate.resolve())

    return None


def _resolve_cookies_for_provider(provider: str) -> tuple[str | None, dict[str, Any] | None]:
    """Elite Concurrency Doctrine: Dynamic Cookie Vault with static fallback.
    
    Tries the dynamic Supabase cookie vault first for multi-account rotation,
    then falls back to the static cookies.txt file.
    
    Returns: (cookie_file_path, vault_info_dict_or_None)
    """
    # ── Vault-first strategy ──
    vault_info: dict[str, Any] | None = None
    try:
        vault_info = acquire_vault_cookie_file(provider)
        if vault_info and vault_info.get("path"):
            log.debug("Cookie vault acquired for %s (source=%s)", provider, vault_info.get("source"))
            return vault_info["path"], vault_info
    except Exception as exc:
        log.warning("Cookie vault acquisition failed for %s: %s", provider, exc)

    # ── Static fallback ──
    static_path = _resolve_cookies_file()
    if static_path:
        return static_path, None
    return None, None


def prepare_runtime_cookies_file() -> str | None:
    source = _resolve_cookies_file()
    if not source:
        return None

    fd, temp_path = tempfile.mkstemp(prefix="nexus_cookies_", suffix=".txt", dir=RUNTIME_COOKIE_DIR)
    os.close(fd)
    shutil.copy2(source, temp_path)
    return temp_path


def cleanup_runtime_cookies_file(path: str | None) -> None:
    if not path:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def build_browser_identity_args(*, include_cookies: bool = True, cookies_file: str | None = None) -> list[str]:
    args = [
        "--impersonate",
        "chrome",
        "--user-agent",
        CHROME_USER_AGENT,
        "--add-header",
        CHROME_ACCEPT_LANGUAGE,
    ]

    js_runtime = _resolve_js_runtime()
    if js_runtime:
        args.extend(["--js-runtimes", js_runtime])
        args.extend(["--remote-components", os.environ.get("YTDLP_REMOTE_COMPONENTS", "ejs:github")])

    if include_cookies and cookies_file:
        args.extend(["--cookies", cookies_file])

    return args


def _metadata_args(
    url: str,
    *,
    proxy_url: str | None = None,
    cookies_file: str | None = None,
    lightweight_probe: bool = False,
    use_browser_identity: bool = True,
    youtube_extractor_args_cli: list[str] | None = None,
) -> list[str]:
    yt_dlp_path = _resolve_yt_dlp_binary()
    if not yt_dlp_path:
        raise MediaExtractionError("yt-dlp binary is missing from backend/bin or PATH.", status_code=500, code="missing_ytdlp")
    args = [yt_dlp_path]
    if use_browser_identity:
        args.extend(build_browser_identity_args(include_cookies=bool(cookies_file), cookies_file=cookies_file))
    args.extend(
        [
            "-J",
            "--no-playlist",
            "--no-warnings",
            "--js-runtimes",
            "node",
        ]
    )

    if lightweight_probe:
        # Lightweight probe mode keeps single-video accuracy while avoiding deep playlist
        # resolution and expensive manifest/subtitle work.
        args.extend(
            [
                "--quiet",
                "--flat-playlist",
                "--no-check-certificates",
                "--extractor-retries",
                "1",
                "--socket-timeout",
                "5",
                "--source-address",
                "0.0.0.0",
                "--compat-options",
                "no-youtube-unavailable-videos",
            ]
        )
    else:
        args.extend(
            [
                "--extractor-retries",
                "3",
                "--socket-timeout",
                "15",
            ]
        )
    for extractor_arg in youtube_extractor_args_cli or []:
        args.extend(["--extractor-args", extractor_arg])

    args.append(url)

    if proxy_url:
        args.extend(["--proxy", proxy_url])
    return args


def _cookie_attempts(runtime_cookies_file: str | None) -> list[str | None]:
    attempts: list[str | None] = [None]
    if runtime_cookies_file:
        attempts.append(runtime_cookies_file)
    return attempts


def _should_mark_proxy_burn(output: str) -> bool:
    lowered = (output or "").lower()
    return any(
        token in lowered
        for token in (
            "429",
            "too many requests",
            "rate-limit",
            "rate limit",
            "captcha",
            "temporarily blocked",
        )
    )


def _is_youtube_target(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").lower()
    return hostname.endswith("youtube.com") or hostname == "youtu.be"


def _normalize_youtube_po_token_payload(payload: Any) -> dict[str, str] | None:
    if not isinstance(payload, dict):
        return None

    source = payload
    if isinstance(payload.get("data"), dict):
        source = payload["data"]
    elif isinstance(payload.get("result"), dict):
        source = payload["result"]

    visitor_data = str(
        source.get("visitorData")
        or source.get("visitor_data")
        or source.get("visitor")
        or ""
    ).strip()
    po_token = str(
        source.get("poToken")
        or source.get("po_token")
        or source.get("token")
        or ""
    ).strip()

    if not visitor_data or not po_token:
        return None
    if payload.get("success") is False:
        return None
    return {"visitorData": visitor_data, "poToken": po_token}


def _get_po_token_client() -> httpx.AsyncClient:
    """Elite Concurrency Doctrine: Persistent httpx client with keep-alive warming.
    
    Instead of creating a new TCP/TLS connection per PO token request,
    this singleton reuses the same warmed connection pool."""
    global _PO_TOKEN_CLIENT
    if _PO_TOKEN_CLIENT is None or _PO_TOKEN_CLIENT.is_closed:
        _PO_TOKEN_CLIENT = httpx.AsyncClient(
            timeout=httpx.Timeout(
                YOUTUBE_PO_TOKEN_TIMEOUT_SECONDS,
                connect=YOUTUBE_PO_TOKEN_TIMEOUT_SECONDS,
                read=YOUTUBE_PO_TOKEN_TIMEOUT_SECONDS,
                write=YOUTUBE_PO_TOKEN_TIMEOUT_SECONDS,
                pool=YOUTUBE_PO_TOKEN_TIMEOUT_SECONDS,
            ),
            limits=httpx.Limits(
                max_keepalive_connections=5,
                max_connections=10,
                keepalive_expiry=30,
            ),
        )
    return _PO_TOKEN_CLIENT


async def _fetch_youtube_po_token_bundle(url: str) -> dict[str, str] | None:
    if not _is_youtube_target(url) or not YOUTUBE_PO_TOKEN_SIDECAR_URL:
        return None

    try:
        client = _get_po_token_client()
        response = await client.get(YOUTUBE_PO_TOKEN_SIDECAR_URL, params={"url": url})
        response.raise_for_status()
        return _normalize_youtube_po_token_payload(response.json())
    except Exception:
        return None


def _get_youtube_po_token_bundle(url: str) -> dict[str, str] | None:
    if not _is_youtube_target(url):
        return None
    try:
        return asyncio.run(_fetch_youtube_po_token_bundle(url))
    except RuntimeError:
        return None


def _youtube_probe_extractor_args(po_token_bundle: dict[str, str] | None) -> dict[str, dict[str, list[str]]]:
    if po_token_bundle:
        return {
            "youtube": {
                "player_client": ["default", "ios"],
                "po_token": [f"ios+{po_token_bundle['poToken']}"],
                "visitor_data": [po_token_bundle["visitorData"]],
            }
        }
    return {
        "youtube": {
            "player_client": ["visionos", "android", "tv", "web"],
        }
    }


def _youtube_probe_extractor_args_cli(po_token_bundle: dict[str, str] | None) -> list[str]:
    if po_token_bundle:
        return [
            "youtube:"
            f"player_client=default,ios;po_token=ios+{po_token_bundle['poToken']};"
            f"visitor_data={po_token_bundle['visitorData']}"
        ]
    return [
        "youtube:player_client=visionos,android,tv,web"
    ]


def _youtube_pool_probe_budget() -> int:
    return max(1, int(os.environ.get("YOUTUBE_PROXY_POOL_MAX_PROBE_CANDIDATES", "3")))


def _is_youtube_bot_block(output: str) -> bool:
    """Detect YouTube's 'Sign in to confirm you're not a bot' error."""
    lowered = (output or "").lower()
    return any(
        token in lowered
        for token in (
            "sign in to confirm",
            "confirm you're not a bot",
            "proof of origin",
            "po token",
            "pot provider",
            "botguard",
            "visitor data",
        )
    )


def _normalize_error(output: str, *, provider: str | None = None) -> MediaExtractionError:
    detail = " ".join((output or "").replace("\r", "\n").split()).strip() or "Extraction failure."
    lowered = detail.lower()

    if "drm" in lowered or "widevine" in lowered:
        return MediaExtractionError("Content not accessible", status_code=422, code="drm_protected")
    if "video unavailable" in lowered or "this video is unavailable" in lowered:
        return MediaExtractionError(
            "This video is unavailable, private, or has been removed by the source platform.",
            status_code=422,
            code="video_unavailable",
        )
    if "private" in lowered or "members only" in lowered or "login" in lowered:
        return MediaExtractionError("Content not accessible", status_code=403, code="content_private")
    if "unsupported url" in lowered or "unsupported" in lowered:
        return MediaExtractionError("Invalid or unsupported URL", status_code=422, code="unsupported_url")
    if "unable to download json metadata" in lowered or "tls" in lowered or "handshake" in lowered:
        return MediaExtractionError("Network issue while contacting provider", status_code=503, code="network_issue")
    if provider == "youtube" and _is_youtube_bot_block(detail):
        return MediaExtractionError(
            "YouTube Anti-Bot Triggered: Upstream rate limit. Please try again or use proxy.",
            status_code=429,
            code="youtube_antibot_triggered",
        )
    return MediaExtractionError(detail, status_code=422, code="extraction_failed")


def _extract_probe_info_with_yt_dlp(
    url: str,
    *,
    proxy_url: str | None = None,
    cookies_file: str | None = None,
    use_browser_identity: bool = False,
    youtube_extractor_args: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if yt_dlp is None:
        raise RuntimeError("yt_dlp Python API unavailable")

    options: dict[str, Any] = {
        "ignoreconfig": True,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 5,
        "nocheckcertificate": True,
        "source_address": "0.0.0.0",
        "extract_flat": "in_playlist",
        "compat_opts": ["no-youtube-unavailable-videos"],
        "skip_download": True,
        "js_runtimes": {"node": {}},
    }
    if youtube_extractor_args:
        options["extractor_args"] = youtube_extractor_args
    
    # -- Elite Upgrade: Reddit API Authentication --------------------------
    reddit_id = os.environ.get("REDDIT_CLIENT_ID", "").strip()
    reddit_secret = os.environ.get("REDDIT_CLIENT_SECRET", "").strip()
    if reddit_id and reddit_secret:
        if "extractor_args" not in options:
            options["extractor_args"] = {}
        options["extractor_args"]["reddit"] = [
            f"client_id={reddit_id}",
            f"client_secret={reddit_secret}",
        ]

    if proxy_url:
        options["proxy"] = proxy_url
    if cookies_file:
        options["cookiefile"] = cookies_file
    if use_browser_identity:
        options["http_headers"] = {"Accept-Language": "en-US,en;q=0.9"}
        options["user_agent"] = CHROME_USER_AGENT

    with yt_dlp.YoutubeDL(options) as ydl:
        return ydl.extract_info(url, download=False)


def get_cached_probe_payload(url: str) -> dict[str, Any] | None:
    normalized = normalize_media_url(url)
    return _get_probe_cache_payload(normalized)


def extract_media_info(
    url: str,
    *,
    timeout_seconds: int = SUBPROCESS_TIMEOUT_SECONDS,
    lightweight_probe: bool = False,
) -> dict[str, Any]:
    ensure_media_binaries()
    normalized = normalize_media_url(url)
    provider = get_provider_name(normalized)
    proxy_url = get_metadata_proxy_url(provider)
    runtime_cookies_file: str | None = None
    youtube_pool_attempt_groups: list[tuple[dict[str, Any], list[tuple[bool, str | None, str | None]]]] = []

    if lightweight_probe:
        cached = _get_probe_cache_payload(normalized)
        if cached:
            return cached

    youtube_po_token_bundle = _get_youtube_po_token_bundle(normalized) if provider == "youtube" else None
    youtube_extractor_args = _youtube_probe_extractor_args(youtube_po_token_bundle) if provider == "youtube" else None
    youtube_extractor_args_cli = _youtube_probe_extractor_args_cli(youtube_po_token_bundle) if provider == "youtube" else []

    combined_output = ""
    normalized_error: MediaExtractionError | None = None
    youtube_antibot_error: MediaExtractionError | None = None
    result = None
    used_proxy = False
    try:
        # ── Elite Concurrency Doctrine: Cookie Vault Integration ──────────
        vault_cookie_info: dict[str, Any] | None = None
        if lightweight_probe:
            vault_cookie_path, vault_cookie_info = _resolve_cookies_for_provider(provider)
            if vault_cookie_path and vault_cookie_info and vault_cookie_info.get("source") == "vault":
                runtime_cookies_file = vault_cookie_path
            else:
                resolved_cookies = _resolve_cookies_file()
                if resolved_cookies:
                    runtime_cookies_file = prepare_runtime_cookies_file()
            if provider == "youtube":
                seen_proxy_ids: set[str] = set()
                for _ in range(_youtube_pool_probe_budget()):
                    allocation = acquire_youtube_proxy()
                    if not allocation.get("configured"):
                        break
                    if not allocation.get("available"):
                        if not youtube_pool_attempt_groups:
                            raise MediaExtractionError(
                                "YouTube Anti-Bot Triggered: Upstream rate limit. Please try again or use proxy.",
                                status_code=429,
                                code="youtube_antibot_triggered",
                            )
                        break
                    proxy_id = str(allocation.get("proxy_id") or "")
                    if proxy_id in seen_proxy_ids:
                        continue
                    seen_proxy_ids.add(proxy_id)
                    proxy_attempts: list[tuple[bool, str | None, str | None]] = [
                        (False, None, str(allocation["proxy_url"])),
                        (True, None, str(allocation["proxy_url"])),
                    ]
                    if runtime_cookies_file:
                        proxy_attempts.append((True, runtime_cookies_file, str(allocation["proxy_url"])))
                    youtube_pool_attempt_groups.append((allocation, proxy_attempts))

            attempt_specs: list[tuple[bool, str | None, str | None]] = []
            if not youtube_pool_attempt_groups:
                attempt_specs = [
                    (False, None, None),  # fastest cold-path strike
                    (True, None, None),   # browser identity without cookie-copy cost
                ]
                if runtime_cookies_file:
                    attempt_specs.append((True, runtime_cookies_file, None))
                if proxy_url:
                    attempt_specs.extend(
                        [
                            (False, None, proxy_url),
                            (True, None, proxy_url),
                        ]
                    )
                    if runtime_cookies_file:
                        attempt_specs.append((True, runtime_cookies_file, proxy_url))
        else:
            runtime_cookies_file = prepare_runtime_cookies_file()
            attempt_specs = [(True, cookies_candidate, proxy_url) for cookies_candidate in _cookie_attempts(runtime_cookies_file)]

        if lightweight_probe and yt_dlp is not None:
            payload = None
            if youtube_pool_attempt_groups:
                for allocation, proxy_attempts in youtube_pool_attempt_groups:
                    proxy_error: MediaExtractionError | None = None
                    proxy_output = ""
                    for use_browser_identity, cookies_candidate, attempt_proxy_url in proxy_attempts:
                        try:
                            payload = _extract_probe_info_with_yt_dlp(
                                normalized,
                                proxy_url=attempt_proxy_url,
                                cookies_file=cookies_candidate,
                                use_browser_identity=use_browser_identity,
                                youtube_extractor_args=youtube_extractor_args,
                            )
                            used_proxy = True
                            record_youtube_proxy_result(str(allocation["proxy_url"]), success=True)
                            break
                        except Exception as exc:
                            proxy_output = str(exc)
                            proxy_error = _normalize_error(proxy_output, provider=provider)
                            normalized_error = proxy_error
                            if proxy_error.code == "youtube_antibot_triggered":
                                youtube_antibot_error = proxy_error
                            if proxy_error.code == "network_issue":
                                time.sleep(0.1)
                            continue
                    if payload is not None:
                        break
                    used_proxy = True
                    record_youtube_proxy_result(
                        str(allocation["proxy_url"]),
                        success=False,
                        reason=proxy_output or getattr(proxy_error, "code", "youtube_probe_failed"),
                    )
            else:
                for use_browser_identity, cookies_candidate, attempt_proxy_url in attempt_specs:
                    try:
                        payload = _extract_probe_info_with_yt_dlp(
                            normalized,
                            proxy_url=attempt_proxy_url,
                            cookies_file=cookies_candidate,
                            use_browser_identity=use_browser_identity,
                            youtube_extractor_args=youtube_extractor_args,
                        )
                        used_proxy = bool(attempt_proxy_url)
                        break
                    except Exception as exc:
                        combined_output = str(exc)
                        normalized_error = _normalize_error(combined_output, provider=provider)
                        if normalized_error.code == "youtube_antibot_triggered":
                            youtube_antibot_error = normalized_error
                        if normalized_error.code != "network_issue":
                            continue
                        time.sleep(0.15)

            if payload is None:
                final_error = youtube_antibot_error or normalized_error
                if used_proxy and not youtube_pool_attempt_groups and _should_mark_proxy_burn(combined_output):
                    mark_proxy_burned("metadata_429_or_block", provider=provider)
                if not youtube_pool_attempt_groups:
                    record_proxy_probe(
                        success=False,
                        via_proxy=used_proxy,
                        provider=provider,
                        reason=getattr(final_error, "code", "extraction_failed"),
                    )
                raise final_error or MediaExtractionError("Metadata probe failed.", status_code=422, code="extraction_failed")

            _set_probe_cache_payload(normalized, payload)
            if not youtube_pool_attempt_groups:
                record_proxy_probe(success=True, via_proxy=used_proxy, provider=provider)
            return payload

        for use_browser_identity, cookies_candidate, attempt_proxy_url in attempt_specs:
            max_attempts = 2
            for attempt in range(max_attempts):
                result = subprocess.run(
                    _metadata_args(
                        normalized,
                        proxy_url=attempt_proxy_url,
                        cookies_file=cookies_candidate,
                        lightweight_probe=lightweight_probe,
                        use_browser_identity=use_browser_identity,
                        youtube_extractor_args_cli=youtube_extractor_args_cli,
                    ),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=timeout_seconds,
                    env=_build_subprocess_env(),
                )
                if result.returncode == 0:
                    used_proxy = bool(attempt_proxy_url)
                    break
                combined_output = result.stderr or result.stdout or ""
                normalized_error = _normalize_error(combined_output, provider=provider)
                if normalized_error.code == "youtube_antibot_triggered":
                    youtube_antibot_error = normalized_error
                if normalized_error.code != "network_issue" or attempt == max_attempts - 1:
                    break
                time.sleep(0.25 if lightweight_probe else 1.0)
            if result is not None and result.returncode == 0:
                break

        if result is None:
            raise MediaExtractionError("Extractor did not return a result.", status_code=500, code="invalid_metadata")

        if result.returncode != 0:
            combined_output = result.stderr or result.stdout or ""
            normalized_error = youtube_antibot_error or normalized_error or _normalize_error(combined_output, provider=provider)

            if result.returncode != 0:
                if used_proxy and _should_mark_proxy_burn(combined_output):
                    mark_proxy_burned("metadata_429_or_block", provider=provider)
                record_proxy_probe(
                    success=False,
                    via_proxy=used_proxy,
                    provider=provider,
                    reason=getattr(normalized_error, "code", "extraction_failed"),
                )
                raise normalized_error

        try:
            payload = json.loads(result.stdout or "{}")
        except json.JSONDecodeError as exc:
            record_proxy_probe(
                success=False,
                via_proxy=used_proxy,
                provider=provider,
                reason="invalid_metadata",
            )
            raise MediaExtractionError("Extractor returned invalid metadata JSON.", status_code=500, code="invalid_metadata") from exc

        if lightweight_probe:
            _set_probe_cache_payload(normalized, payload)
        record_proxy_probe(success=True, via_proxy=used_proxy, provider=provider)
        # ── Elite: Track cookie vault success ──
        if vault_cookie_info and vault_cookie_info.get("account_id"):
            record_cookie_result(vault_cookie_info["account_id"], success=True)
        return payload
    except Exception:
        # ── Elite: Track cookie vault failure ──
        if vault_cookie_info and vault_cookie_info.get("account_id"):
            record_cookie_result(vault_cookie_info["account_id"], success=False, reason="extraction_failed")
        raise
    finally:
        if vault_cookie_info and vault_cookie_info.get("source") == "vault":
            cleanup_vault_cookie_file(vault_cookie_info)
        else:
            cleanup_runtime_cookies_file(runtime_cookies_file)


async def extract_media_info_async(
    url: str,
    *,
    timeout_seconds: int = SUBPROCESS_TIMEOUT_SECONDS,
    lightweight_probe: bool = False,
) -> dict[str, Any]:
    """Non-blocking async wrapper — runs the subprocess in a thread pool executor
    so it never stalls the uvicorn event loop during long yt-dlp metadata fetches."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: extract_media_info(url, timeout_seconds=timeout_seconds, lightweight_probe=lightweight_probe),
    )


def get_formats(url: str) -> dict[str, Any]:
    info = extract_media_info(url, lightweight_probe=True)
    return build_formats_payload(info)


def get_provider_name(url: str) -> str:
    hostname = (urlparse(url).hostname or "").lower()
    if hostname == "dai.ly" or hostname.endswith("dailymotion.com"):
        return "dailymotion"
    if hostname.endswith("spotify.com"):
        return "spotify"
    if hostname.endswith("youtube.com") or hostname == "youtu.be":
        return "youtube"
    return hostname or "unknown"


def get_provider_capability(url: str) -> dict[str, Any]:
    """Lightweight provider capability check using regex pattern matching.
    Does NOT run yt-dlp extraction — just checks if the domain is known/supported.
    This eliminates the double-probe latency that was killing scan speed."""
    hostname = (urlparse(url).hostname or "").lower()
    provider = get_provider_name(url)

    # ── DRM-protected providers (instant reject) ────────────────────────────
    for drm_host in _DRM_PROVIDERS:
        if hostname.endswith(drm_host):
            return {
                "provider": provider,
                "supported": False,
                "available": False,
                "reason": "drm_protected",
                "detail": "This source is protected by DRM, so direct extraction is not supported.",
            }

    # ── Known providers (instant OK — actual errors caught at extraction time) ─
    for prov_name, pattern in _KNOWN_PROVIDERS.items():
        if pattern.search(hostname):
            return {
                "provider": prov_name,
                "supported": True,
                "available": True,
                "reason": "ok",
                "detail": "",
            }

    # ── Unknown but valid URL — assume supported (yt-dlp supports 1000+ sites) ─
    if hostname and len(hostname) > 3:
        return {
            "provider": provider,
            "supported": True,
            "available": True,
            "reason": "ok",
            "detail": "",
        }

    return {
        "provider": "unknown",
        "supported": False,
        "available": False,
        "reason": "unsupported_url",
        "detail": "Invalid or unsupported URL.",
    }
