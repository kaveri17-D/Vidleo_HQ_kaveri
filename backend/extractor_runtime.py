from __future__ import annotations

import re
import time
from urllib.parse import urlparse

from backend.extractor_service import MediaExtractionError, extract_media_info, get_provider_capability as get_binary_provider_capability

PROVIDER_STATUS_TTL_SECONDS = 300
PROVIDER_STATUS_CACHE: dict[str, dict] = {}
ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*m")


def get_provider_name(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if host == "dai.ly" or host.endswith("dailymotion.com"):
        return "dailymotion"
    if host.endswith("spotify.com"):
        return "spotify"
    return host or "unknown"


def clean_extractor_message(exc_or_message: Exception | str) -> str:
    message = ANSI_ESCAPE_RE.sub("", str(exc_or_message)).replace("\r", " ").replace("\n", " ").strip()
    return re.sub(r"\s+", " ", message)


def is_transport_error(exc_or_message: Exception | str) -> bool:
    lowered = clean_extractor_message(exc_or_message).lower()
    return "handshake" in lowered or "tls" in lowered or "unexpected_eof_while_reading" in lowered


def is_platform_transport_issue(url: str, exc_or_message: Exception | str) -> bool:
    return get_provider_name(url) in {"dailymotion"} and is_transport_error(exc_or_message)


def is_drm_issue(exc_or_message: Exception | str) -> bool:
    lowered = clean_extractor_message(exc_or_message).lower()
    return "drm" in lowered or "widevine" in lowered or "fairplay" in lowered


def is_login_or_private_issue(exc_or_message: Exception | str) -> bool:
    lowered = clean_extractor_message(exc_or_message).lower()
    return any(marker in lowered for marker in ("private", "login", "sign in", "members only", "premium"))


def build_user_facing_extractor_error(url: str, exc_or_message: Exception | str, *, action: str) -> str:
    if is_drm_issue(exc_or_message):
        return "This source is protected by DRM, so direct extraction is not supported."
    if is_login_or_private_issue(exc_or_message):
        return "This source is private or requires login, so extraction cannot continue from the public proxy."
    if is_platform_transport_issue(url, exc_or_message):
        return (
            "This platform is reachable in the browser, but the backend could not complete a secure "
            f"handshake with the upstream provider during {action}."
        )
    return f"{action.capitalize()} failed: {clean_extractor_message(exc_or_message)}"


def note_provider_issue(url: str, exc_or_message: Exception | str) -> None:
    provider = get_provider_name(url)
    if not is_platform_transport_issue(url, exc_or_message):
        return
    PROVIDER_STATUS_CACHE[provider] = {
        "available": False,
        "supported": True,
        "reason": "upstream_handshake",
        "detail": build_user_facing_extractor_error(url, exc_or_message, action="metadata probe"),
        "checked_at": time.time(),
    }


def get_provider_capability(url: str) -> dict:
    """Lightweight capability check — uses fast regex matching instead of running
    a full yt-dlp extraction.  Falls back to cached transport-issue status if one
    was recorded recently."""
    provider = get_provider_name(url)

    # Return cached transport issues (e.g. Dailymotion TLS failures)
    cached = PROVIDER_STATUS_CACHE.get(provider)
    if cached and (time.time() - cached.get("checked_at", 0) <= PROVIDER_STATUS_TTL_SECONDS):
        return {**cached, "provider": provider}

    # Use the fast regex-based check from extractor_service (no yt-dlp spawn)
    capability = get_binary_provider_capability(url)
    return capability


def extract_info_with_fallback(url: str, opts: dict | None = None) -> dict:
    try:
        return extract_media_info(url)
    except MediaExtractionError as exc:
        raise RuntimeError(str(exc)) from exc
