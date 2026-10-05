"""NEXUS MediaManifest Builder.

Constructs versioned MediaManifest v1 instances from yt-dlp extracted stream metadata.
"""
from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from backend.manifest_schema import (
    AccessRequirements,
    ManifestFallbackConfig,
    ManifestRefreshConfig,
    ManifestSecurity,
    MediaManifest,
    MediaStreams,
    SourceMetadata,
    StreamMediaItem,
)


def _safe_str(val: Any) -> str:
    return str(val or "").strip()


def build_media_manifest(
    raw_info: Dict[str, Any],
    job_id: str,
    normalized_url: str,
    provider: str = "generic"
) -> MediaManifest:
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    duration = float(raw_info.get("duration") or 0)
    title = raw_info.get("title") or "Untitled Media"
    thumbnail = raw_info.get("thumbnail")
    uploader = raw_info.get("uploader") or raw_info.get("channel")

    formats = raw_info.get("formats") or []
    progressive_list: List[StreamMediaItem] = []
    video_list: List[StreamMediaItem] = []
    audio_list: List[StreamMediaItem] = []
    hls_list: List[StreamMediaItem] = []

    for f in formats:
        url = f.get("url")
        if not url or not isinstance(url, str):
            continue

        format_id = _safe_str(f.get("format_id"))
        if not format_id:
            continue

        parsed_url = urlparse(url)
        host = parsed_url.hostname or "cdn"

        vcodec = _safe_str(f.get("vcodec"))
        acodec = _safe_str(f.get("acodec"))
        ext = _safe_str(f.get("ext")).lower() or "mp4"

        width = f.get("width")
        height = f.get("height")
        filesize = f.get("filesize") or f.get("filesize_approx")
        tbr = f.get("tbr")
        bitrate = int(tbr * 1000) if tbr else (f.get("vbr") or f.get("abr"))

        # Detect headers required
        headers_required = {}
        if f.get("http_headers"):
            for h_key, h_val in f["http_headers"].items():
                if h_key.lower() in {"user-agent", "referer", "origin"}:
                    headers_required[h_key] = h_val

        # Range supported
        range_supported = True
        protocol = _safe_str(f.get("protocol")).lower()
        is_hls = "m3u8" in protocol or "hls" in protocol or ".m3u8" in url.lower()
        if is_hls:
            range_supported = False

        # CORS and Relay requirements
        cors_accessible = True
        relay_required = False
        if provider.lower() in {"youtube", "googlevideo"} or "googlevideo.com" in host.lower():
            cors_accessible = False
            relay_required = True

        # Classify stream item
        if is_hls:
            hls_list.append(StreamMediaItem(
                id=f"hls-{format_id}",
                url=url,
                host=host,
                format_id=format_id,
                container="m3u8",
                codec=f"{vcodec}+{acodec}" if (vcodec and acodec and vcodec != "none" and acodec != "none") else (vcodec or acodec or "h264+aac"),
                type="progressive" if (vcodec and acodec and vcodec != "none" and acodec != "none") else ("video" if vcodec != "none" else "audio"),
                bitrate=int(bitrate) if bitrate else None,
                width=int(width) if width else None,
                height=int(height) if height else None,
                fps=f.get("fps"),
                duration=duration,
                filesize=int(filesize) if filesize else None,
                range_supported=False,
                cors_accessible=cors_accessible,
                relay_required=relay_required,
                headers_required=headers_required,
                protocol="hls",
                is_hls=True,
                hls_type="master" if "manifest" in url.lower() or "master" in format_id.lower() else "media"
            ))
        elif vcodec != "none" and acodec != "none" and vcodec and acodec:
            progressive_list.append(StreamMediaItem(
                id=f"prog-{format_id}",
                url=url,
                host=host,
                format_id=format_id,
                container=ext,
                codec=f"{vcodec}+{acodec}",
                type="progressive",
                bitrate=int(bitrate) if bitrate else None,
                width=int(width) if width else None,
                height=int(height) if height else None,
                fps=f.get("fps"),
                duration=duration,
                filesize=int(filesize) if filesize else None,
                range_supported=range_supported,
                cors_accessible=cors_accessible,
                relay_required=relay_required,
                headers_required=headers_required
            ))
        elif vcodec != "none" and vcodec:
            video_list.append(StreamMediaItem(
                id=f"video-{format_id}",
                url=url,
                host=host,
                format_id=format_id,
                container=ext,
                codec=vcodec,
                type="video",
                bitrate=int(bitrate) if bitrate else None,
                width=int(width) if width else None,
                height=int(height) if height else None,
                fps=f.get("fps"),
                duration=duration,
                filesize=int(filesize) if filesize else None,
                range_supported=range_supported,
                cors_accessible=cors_accessible,
                relay_required=relay_required,
                headers_required=headers_required
            ))
        elif acodec != "none" and acodec:
            audio_list.append(StreamMediaItem(
                id=f"audio-{format_id}",
                url=url,
                host=host,
                format_id=format_id,
                container=ext,
                codec=acodec,
                type="audio",
                bitrate=int(f.get("abr") or bitrate or 128),
                duration=duration,
                filesize=int(filesize) if filesize else None,
                range_supported=range_supported,
                cors_accessible=cors_accessible,
                relay_required=relay_required,
                headers_required=headers_required
            ))

    # Sort video by height descending, audio by bitrate descending
    video_list.sort(key=lambda x: x.height or 0, reverse=True)
    audio_list.sort(key=lambda x: x.bitrate or 0, reverse=True)
    hls_list.sort(key=lambda x: (x.height or 0, x.bitrate or 0), reverse=True)

    # Collect allowed hosts
    allowed_hosts = list({item.host for item in (progressive_list + video_list + audio_list + hls_list)})

    return MediaManifest(
        manifest_version="1",
        job_id=job_id,
        source=SourceMetadata(
            url=normalized_url,
            canonical_url=normalized_url,
            provider=provider,
            title=title,
            duration=duration,
            thumbnail=thumbnail,
            uploader=uploader
        ),
        media=MediaStreams(
            progressive=progressive_list,
            video=video_list,
            audio=audio_list,
            hls=hls_list
        ),
        access=AccessRequirements(
            method="GET",
            range_supported=True,
            expires_at=None
        ),
        refresh=ManifestRefreshConfig(
            refresh_supported=True,
            refresh_url=f"/api/downloads/{job_id}/manifest"
        ),
        fallback=ManifestFallbackConfig(
            server_fallback_allowed=True
        ),
        security=ManifestSecurity(
            ticket_required=any(item.relay_required for item in (progressive_list + video_list + audio_list + hls_list)),
            allowed_hosts=allowed_hosts
        ),
        created_at=now_iso
    )
