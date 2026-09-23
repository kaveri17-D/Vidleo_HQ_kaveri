from __future__ import annotations

from typing import Any, Optional

MAX_TELEGRAM_MB = 50
MAX_DISCORD_MB = 25
MAX_TELEGRAM_BYTES = MAX_TELEGRAM_MB * 1024 * 1024
MAX_DISCORD_BYTES = MAX_DISCORD_MB * 1024 * 1024
MAX_SIZE_MB = MAX_TELEGRAM_MB
MAX_SIZE_BYTES = MAX_TELEGRAM_BYTES
OWNER_QUALITY_HEIGHT = 2160
FALLBACK_AUDIO_BITRATE = 128


def _size_bytes(raw: dict[str, Any], duration: Optional[float]) -> Optional[int]:
    filesize = raw.get("filesize") or raw.get("filesize_approx")
    if filesize:
        return int(filesize)

    total_bitrate = raw.get("tbr")
    if total_bitrate and duration:
        return int((float(total_bitrate) * 1000 / 8) * float(duration))

    audio_bitrate = raw.get("abr")
    if audio_bitrate and duration:
        return int((float(audio_bitrate) * 1000 / 8) * float(duration))

    return None


def _size_mb(size_bytes: Optional[int]) -> Optional[int]:
    if not size_bytes:
        return None
    return max(1, round(size_bytes / (1024 * 1024)))


def _resolution_label(height: Optional[int], ext: str) -> str:
    if height:
        return f"{int(height)}p"
    return ext.upper()


def _audio_label(abr: Optional[float], ext: str) -> str:
    if abr:
        return f"{int(round(float(abr)))}kbps"
    return ext.upper()


def _telegram_blocked(size_bytes: Optional[int]) -> bool:
    return bool(size_bytes and size_bytes > MAX_TELEGRAM_BYTES)


def _discord_blocked(size_bytes: Optional[int]) -> bool:
    return bool(size_bytes and size_bytes > MAX_DISCORD_BYTES)


def _format_resolution(raw: dict[str, Any]) -> Optional[str]:
    width = raw.get("width")
    height = raw.get("height")
    if width and height:
        return f"{width}x{height}"
    return None


def _build_video_item(raw: dict[str, Any], duration: Optional[float]) -> Optional[dict[str, Any]]:
    format_id = raw.get("format_id")
    height = raw.get("height")
    ext = str(raw.get("ext") or "").lower()
    if not format_id or raw.get("vcodec", "none") == "none" or not height or not ext:
        return None

    note = str(raw.get("format_note") or raw.get("format") or "").lower()
    if ext in {"mhtml", "ism"} or "storyboard" in note:
        return None

    size_bytes = _size_bytes(raw, duration)
    if not size_bytes:
        return None

    quality = _resolution_label(height, ext)
    has_audio = raw.get("acodec", "none") != "none"
    selector = str(format_id) if has_audio else f"{format_id}+bestaudio[ext=m4a]/bestaudio/best"
    return {
        "id": str(format_id),
        "format_id": str(format_id),
        "quality": quality,
        "label": quality,
        "size_mb": _size_mb(size_bytes),
        "size": _size_mb(size_bytes),
        "filesize": size_bytes,
        "type": "video",
        "ext": ext,
        "height": int(height),
        "width": raw.get("width"),
        "resolution": _format_resolution(raw),
        "fps": raw.get("fps"),
        "has_audio": has_audio,
        "download_selector": selector,
        "requires_owner": int(height) >= OWNER_QUALITY_HEIGHT,
        "telegram_safe": not _telegram_blocked(size_bytes),
        "discord_safe": not _discord_blocked(size_bytes),
        "too_large_for_telegram": _telegram_blocked(size_bytes),
        "too_large_for_discord": _discord_blocked(size_bytes),
        "blocked": False,
        "blocked_for": [],
    }


def _build_audio_item(raw: dict[str, Any], duration: Optional[float]) -> Optional[dict[str, Any]]:
    format_id = raw.get("format_id")
    ext = str(raw.get("ext") or "").lower()
    if not format_id or raw.get("vcodec", "none") != "none" or raw.get("acodec", "none") == "none" or not ext:
        return None

    abr = raw.get("abr")
    size_bytes = _size_bytes(raw, duration)
    if not size_bytes:
        return None

    quality = _audio_label(abr, ext)
    return {
        "id": str(format_id),
        "format_id": str(format_id),
        "quality": quality,
        "label": quality,
        "size_mb": _size_mb(size_bytes),
        "size": _size_mb(size_bytes),
        "filesize": size_bytes,
        "type": "audio",
        "ext": ext,
        "height": None,
        "width": None,
        "resolution": None,
        "fps": None,
        "abr": int(round(float(abr))) if abr else None,
        "download_selector": str(format_id),
        "requires_owner": False,
        "telegram_safe": not _telegram_blocked(size_bytes),
        "discord_safe": not _discord_blocked(size_bytes),
        "too_large_for_telegram": _telegram_blocked(size_bytes),
        "too_large_for_discord": _discord_blocked(size_bytes),
        "blocked": False,
        "blocked_for": [],
    }


def _build_fallback_audio_item(raw_formats: list[dict[str, Any]], duration: Optional[float]) -> Optional[dict[str, Any]]:
    muxed_formats = [
        raw
        for raw in raw_formats
        if raw.get("vcodec", "none") != "none" and raw.get("acodec", "none") != "none"
    ]
    if not muxed_formats or not duration:
        return None

    best_muxed = max(muxed_formats, key=lambda item: (item.get("height") or 0, item.get("tbr") or 0))
    estimated_size = int((FALLBACK_AUDIO_BITRATE * 1000 / 8) * float(duration))

    return {
        "id": f"audio-fallback-{FALLBACK_AUDIO_BITRATE}",
        "format_id": f"audio-fallback-{FALLBACK_AUDIO_BITRATE}",
        "quality": f"{FALLBACK_AUDIO_BITRATE}kbps",
        "label": f"{FALLBACK_AUDIO_BITRATE}kbps",
        "size_mb": _size_mb(estimated_size),
        "size": _size_mb(estimated_size),
        "filesize": estimated_size,
        "type": "audio",
        "ext": "mp3",
        "height": None,
        "width": None,
        "resolution": None,
        "fps": None,
        "abr": FALLBACK_AUDIO_BITRATE,
        "download_selector": "bestaudio/best",
        "requires_owner": False,
        "telegram_safe": not _telegram_blocked(estimated_size),
        "discord_safe": not _discord_blocked(estimated_size),
        "too_large_for_telegram": _telegram_blocked(estimated_size),
        "too_large_for_discord": _discord_blocked(estimated_size),
        "blocked": False,
        "blocked_for": [],
    }


def _dedupe(items: list[dict[str, Any]], key_name: str) -> list[dict[str, Any]]:
    chosen: dict[str, dict[str, Any]] = {}
    for item in items:
        key = str(item.get(key_name))
        current = chosen.get(key)
        if current is None:
            chosen[key] = item
            continue

        current_size = current.get("filesize") or 0
        item_size = item.get("filesize") or 0
        current_ext = current.get("ext")
        item_ext = item.get("ext")

        if item_ext == "mp4" and current_ext != "mp4":
            chosen[key] = item
        elif item_size and current_size and item_size < current_size:
            chosen[key] = item

    return list(chosen.values())


def get_video_formats(info: dict[str, Any]) -> list[dict[str, Any]]:
    duration = info.get("duration")
    raw_formats = info.get("formats") or []
    items = [_build_video_item(raw, duration) for raw in raw_formats]
    deduped = _dedupe([item for item in items if item], "quality")
    return sorted(deduped, key=lambda item: item.get("height") or 0)


def get_audio_formats(info: dict[str, Any]) -> list[dict[str, Any]]:
    duration = info.get("duration")
    raw_formats = info.get("formats") or []
    items = [_build_audio_item(raw, duration) for raw in raw_formats]
    deduped = _dedupe([item for item in items if item], "quality")
    if deduped:
        return sorted(deduped, key=lambda item: item.get("abr") or 0)

    fallback = _build_fallback_audio_item(raw_formats, duration)
    if fallback:
        return [fallback]
    return []


def _annotate_limit(formats: list[dict[str, Any]], *, max_bytes: int, platform: str) -> list[dict[str, Any]]:
    annotated: list[dict[str, Any]] = []
    for item in formats:
        copy = dict(item)
        size_bytes = copy.get("filesize")
        blocked = bool(size_bytes and size_bytes > max_bytes)
        blocked_for = list(copy.get("blocked_for") or [])
        if blocked and platform not in blocked_for:
            blocked_for.append(platform)

        copy["blocked"] = blocked
        copy["blocked_for"] = blocked_for
        copy[f"{platform}_safe"] = not blocked
        copy[f"too_large_for_{platform}"] = blocked
        annotated.append(copy)
    return annotated


def filter_for_telegram(formats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return _annotate_limit(formats, max_bytes=MAX_TELEGRAM_BYTES, platform="telegram")


def filter_for_discord(formats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return _annotate_limit(formats, max_bytes=MAX_DISCORD_BYTES, platform="discord")


def build_format_catalog(info_or_formats: dict[str, Any] | list[dict[str, Any]], *, include_owner_formats: bool = True) -> list[dict[str, Any]]:
    if isinstance(info_or_formats, dict):
        info = info_or_formats
    else:
        info = {"formats": info_or_formats, "duration": None}

    video_formats = get_video_formats(info)
    audio_formats = get_audio_formats(info)
    catalog = video_formats + audio_formats

    if not include_owner_formats:
        for item in catalog:
            if item.get("requires_owner"):
                item["blocked"] = True
                blocked_for = list(item.get("blocked_for") or [])
                if "owner" not in blocked_for:
                    blocked_for.append("owner")
                item["blocked_for"] = blocked_for

    return catalog


def _pick_best_thumbnail(info: dict[str, Any]) -> Optional[str]:
    """Return the best available thumbnail URL.

    yt-dlp populates `info["thumbnail"]` for most extractors, but several (Vimeo,
    Dailymotion, some Reddit posts, etc.) only fill the `info["thumbnails"]` list.
    Pick the largest entry from the list when the top-level value is missing,
    falling back to the first entry if no size data is present.
    """
    direct = info.get("thumbnail")
    if direct:
        return str(direct)

    thumbs = info.get("thumbnails")
    if not isinstance(thumbs, list) or not thumbs:
        return None

    valid = [t for t in thumbs if isinstance(t, dict) and t.get("url")]
    if not valid:
        return None

    def _score(t: dict[str, Any]) -> tuple[int, int, int]:
        try:
            width = int(t.get("width") or 0)
        except (TypeError, ValueError):
            width = 0
        try:
            height = int(t.get("height") or 0)
        except (TypeError, ValueError):
            height = 0
        try:
            preference = int(t.get("preference") or 0)
        except (TypeError, ValueError):
            preference = 0
        return (preference, width * height, width + height)

    best = max(valid, key=_score)
    return str(best.get("url"))


def get_formats(info: dict[str, Any]) -> dict[str, Any]:
    video_formats = get_video_formats(info)
    audio_formats = get_audio_formats(info)
    return {
        "title": info.get("title", "Unknown Title"),
        "duration": info.get("duration"),
        "thumbnail": _pick_best_thumbnail(info),
        "uploader": info.get("uploader") or info.get("channel"),
        "video_formats": video_formats,
        "audio_formats": audio_formats,
        "formats": video_formats + audio_formats,
    }


def find_format_option(
    formats: list[dict[str, Any]],
    format_id: str,
    raw_info: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    if not format_id:
        return None

    req = str(format_id).strip()

    # 1. Exact match in catalog
    for item in formats:
        if str(item.get("format_id")) == req or str(item.get("id")) == req:
            return item

    # 2. Compound format selector like "134+140"
    if "+" in req:
        parts = [p.strip() for p in req.split("+") if p.strip()]
        if len(parts) == 2:
            v_id, a_id = parts[0], parts[1]
            raw_formats = (raw_info.get("formats") if isinstance(raw_info, dict) else None) or []
            all_format_ids = {str(f.get("format_id")) for f in raw_formats if isinstance(f, dict)}
            for item in formats:
                all_format_ids.add(str(item.get("format_id")))

            v_exists = v_id in all_format_ids or v_id in {"bestvideo", "bv"}
            a_exists = a_id in all_format_ids or a_id in {"bestaudio", "ba"}

            if v_exists and a_exists:
                v_item = next((item for item in formats if str(item.get("format_id")) == v_id), None)
                quality = v_item.get("quality", "video") if v_item else "video"
                height = v_item.get("height") if v_item else None
                requires_owner = bool(height and height >= OWNER_QUALITY_HEIGHT)

                return {
                    "id": req,
                    "format_id": req,
                    "quality": quality,
                    "label": f"{quality} ({req})",
                    "type": "video",
                    "ext": "mp4",
                    "height": height,
                    "download_selector": req,
                    "requires_owner": requires_owner,
                    "blocked": False,
                    "blocked_for": [],
                }
            elif raw_formats and (not v_exists or not a_exists):
                return None

    # 3. Dynamic aliases like "best", "worst", "default", "bestvideo+bestaudio"
    lowered = req.lower()
    if lowered in {"best", "default", "bestvideo+bestaudio", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"}:
        video_items = [item for item in formats if item.get("type") == "video" and not item.get("requires_owner")]
        if video_items:
            best_item = max(video_items, key=lambda item: item.get("height") or 0)
            choice = dict(best_item)
            choice["download_selector"] = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best"
            return choice
        if formats:
            return dict(formats[0])

    if lowered in {"worst"}:
        video_items = [item for item in formats if item.get("type") == "video"]
        if video_items:
            worst_item = min(video_items, key=lambda item: item.get("height") or 0)
            return dict(worst_item)

    # 4. Check if format_id matches a raw format in raw_info['formats']
    if isinstance(raw_info, dict):
        raw_formats = raw_info.get("formats") or []
        for raw in raw_formats:
            if str(raw.get("format_id")) == req:
                duration = raw_info.get("duration")
                vcodec = raw.get("vcodec", "none")
                acodec = raw.get("acodec", "none")
                if vcodec != "none":
                    item = _build_video_item(raw, duration)
                    if item:
                        return item
                    height = raw.get("height") or 0
                    return {
                        "id": req,
                        "format_id": req,
                        "quality": _resolution_label(height, str(raw.get("ext") or "mp4")),
                        "label": _resolution_label(height, str(raw.get("ext") or "mp4")),
                        "type": "video",
                        "ext": str(raw.get("ext") or "mp4"),
                        "height": int(height),
                        "download_selector": req if acodec != "none" else f"{req}+bestaudio/best",
                        "requires_owner": int(height) >= OWNER_QUALITY_HEIGHT,
                        "blocked": False,
                        "blocked_for": [],
                    }
                elif acodec != "none":
                    item = _build_audio_item(raw, duration)
                    if item:
                        return item
                    return {
                        "id": req,
                        "format_id": req,
                        "quality": _audio_label(raw.get("abr"), str(raw.get("ext") or "m4a")),
                        "label": _audio_label(raw.get("abr"), str(raw.get("ext") or "m4a")),
                        "type": "audio",
                        "ext": str(raw.get("ext") or "mp3"),
                        "download_selector": req,
                        "requires_owner": False,
                        "blocked": False,
                        "blocked_for": [],
                    }

    # 5. Check by resolution tag (e.g., "720p", "1080p", "480p", "360p", "240p", "144p")
    for item in formats:
        if str(item.get("quality", "")).lower() == lowered or str(item.get("label", "")).lower() == lowered:
            return item

    return None
