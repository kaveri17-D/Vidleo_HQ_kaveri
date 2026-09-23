import logging
import os
from typing import Any, Optional

log = logging.getLogger("nexus.utils")

OWNER_ROLES = {"owner", "admin"}
OWNER_ONLY_HEIGHT = 2160
MP3_AUDIO_PRESETS = (192, 256, 320)


def duration_filter(info_dict, *, incomplete):
    """
    Sovereign Time-Gate: Intercepts metadata and kills the process
    if duration exceeds the Sovereign policy (30m video / 60m audio).
    """
    duration = info_dict.get("duration")
    if duration:
        vcodec = info_dict.get("vcodec")
        is_audio = vcodec == "none"
        limit = 3600 if is_audio else 1800

        if duration > limit:
            return f"Media exceeds Sovereign policy ({limit // 60} min)."
    return None


def get_ytdlp_opts(plan: str = "free", is_owner: bool = False) -> dict:
    """
    Sovereign Resource Governor (L9 Code Red):
    Dynamic truncation based on the operative's plan level.
    Owner/admin operators bypass download caps and duration filters.
    """
    item_range = "1-500" if is_owner else ("1-5" if plan == "free" else "1-50")

    opts = {
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": "https://www.google.com/",
        },
        "retries": 5,
        "fragment_retries": 5,
        "socket_timeout": 30,
        "file_access_retries": 3,
        "extract_flat": "in_playlist",
        "playlist_items": item_range,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": False,
        **({"cookiefile": os.environ["COOKIES_FILE"]} if os.environ.get("COOKIES_FILE") else {}),
    }

    if not is_owner:
        opts["max_downloads"] = 5 if plan == "free" else 50
        opts["match_filter"] = duration_filter

    proxy = os.environ.get("PROXY_URL")
    if proxy:
        opts["proxy"] = proxy

    return opts


YTDLP_BASE_OPTS = get_ytdlp_opts("free")


def _normalize_audio_type(ext: str) -> str:
    return "audio-mp3" if ext == "mp3" else "audio"


def _format_quality_label(raw: dict, ftype: str, ext: str) -> str:
    note = str(raw.get("format_note") or raw.get("format") or "").strip()
    lower_note = note.lower()
    height = raw.get("height")
    abr = raw.get("abr")

    if "storyboard" in lower_note:
        return "Storyboard"

    if ftype == "video":
        if height:
            return f"{height}p"
        if raw.get("resolution"):
            return str(raw["resolution"])
        return note or ext.upper()

    if abr:
        return f"{ext.upper()} {int(round(abr))} kbps"
    return note or ext.upper()


def _format_sort_score(fmt: dict) -> int:
    if fmt["type"] == "video":
        return int(fmt.get("height") or 0) * 1000 + int(fmt.get("fps") or 0) + (20 if fmt["ext"] == "mp4" else 0)
    return int(fmt.get("abr") or 0) * 10 + (20 if fmt["ext"] == "mp3" else 0) + (10 if fmt["ext"] == "m4a" else 0)


def _build_mp3_presets(raw_formats: list[dict]) -> list[dict]:
    audio_sources = [
        raw
        for raw in raw_formats
        if raw.get("vcodec", "none") == "none" and raw.get("acodec", "none") != "none"
    ]
    if not audio_sources:
        return []

    best_source = max(audio_sources, key=lambda raw: int(raw.get("abr") or 0))
    max_abr = int(best_source.get("abr") or 0)
    if max_abr < min(MP3_AUDIO_PRESETS):
        return []

    source_filesize = best_source.get("filesize") or best_source.get("filesize_approx") or 0
    presets: list[dict] = []
    for bitrate in MP3_AUDIO_PRESETS:
        if max_abr < bitrate:
            continue

        estimated_size = int(source_filesize * (bitrate / max_abr)) if source_filesize and max_abr else None
        item = {
            "format_id": f"mp3-{bitrate}",
            "label": f"MP3 {bitrate} kbps",
            "type": "audio-mp3",
            "ext": "mp3",
            "filesize": estimated_size,
            "fps": None,
            "abr": bitrate,
            "height": None,
            "width": None,
            "has_audio": True,
            "has_video": False,
            "is_storyboard": False,
            "requires_owner": False,
            "sort_score": 0,
        }
        item["sort_score"] = _format_sort_score(item)
        presets.append(item)

    return presets


def _sanitize_formats(raw_formats: list[dict], include_owner_formats: bool = False) -> list[dict]:
    """
    Returns a stable, UI-friendly format list.
    - Excludes manifest noise and duplicated garbage formats.
    - Marks 4K+ options as owner-only.
    """
    clean: list[dict] = []

    for raw in raw_formats:
        fid = raw.get("format_id")
        ext = str(raw.get("ext") or "").lower()
        if not fid or not ext:
            continue

        note = str(raw.get("format_note") or raw.get("format") or "").lower()
        if ext in {"mhtml", "ism"} or raw.get("format_id") == "sb0":
            # Storyboards and manifest placeholders live in advanced-only land.
            ext = "mhtml"

        vcodec = raw.get("vcodec", "none")
        acodec = raw.get("acodec", "none")
        is_audio = vcodec == "none" and acodec != "none"
        is_storyboard = "storyboard" in note or ext == "mhtml"
        height = raw.get("height")
        requires_owner = bool(height and int(height) >= OWNER_ONLY_HEIGHT)

        if is_storyboard:
            continue

        format_type = _normalize_audio_type(ext) if is_audio else "video"

        item = {
            "format_id": str(fid),
            "label": _format_quality_label(raw, format_type, ext),
            "type": format_type,
            "ext": ext,
            "filesize": raw.get("filesize") or raw.get("filesize_approx"),
            "fps": raw.get("fps"),
            "abr": raw.get("abr"),
            "height": height,
            "width": raw.get("width"),
            "has_audio": acodec != "none",
            "has_video": vcodec != "none",
            "is_storyboard": is_storyboard,
            "requires_owner": requires_owner,
            "sort_score": 0,
        }
        item["sort_score"] = _format_sort_score(item)
        clean.append(item)

    clean.extend(_build_mp3_presets(raw_formats))

    clean.sort(key=lambda fmt: (fmt["type"] != "video", -fmt["sort_score"], -(fmt.get("filesize") or 0)))
    return clean


def _find_requested_format(raw_formats: list[dict], format_id: str) -> Optional[dict]:
    tokens = {
        token.strip()
        for chunk in str(format_id).split("/")
        for token in chunk.split("+")
        if token.strip() and token.strip() not in {"best", "bestaudio", "bestvideo"}
    }

    for fmt in raw_formats:
        if str(fmt.get("format_id")) in tokens:
            return fmt

    for fmt in raw_formats:
        if str(fmt.get("format_id")) == str(format_id):
            return fmt

    return None


def _is_owner_only_format_request(raw_formats: list[dict], format_id: str) -> bool:
    requested = _find_requested_format(raw_formats, format_id)
    if not requested:
        return False

    height = requested.get("height") or 0
    try:
        return int(height) >= OWNER_ONLY_HEIGHT
    except (TypeError, ValueError):
        return False
