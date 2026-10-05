"""NEXUS Deterministic Strategy Engine.

Evaluates MediaManifest, client device capabilities, and policy to produce
EXACTLY ONE deterministic execution strategy.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from backend.manifest_schema import MediaManifest, StreamMediaItem


class StrategyType:
    DIRECT_PROGRESSIVE = "DIRECT_PROGRESSIVE"
    DIRECT_RANGE = "DIRECT_RANGE"
    BROWSER_ADAPTIVE_MUX = "BROWSER_ADAPTIVE_MUX"
    BROWSER_HLS = "BROWSER_HLS"
    SIGNED_WORKER_RANGE = "SIGNED_WORKER_RANGE"
    SERVER_FALLBACK = "SERVER_FALLBACK"
    UNSUPPORTED = "UNSUPPORTED"


class ClientCapabilities(BaseModel):
    fsa_supported: bool = True
    opfs_supported: bool = True
    remux_supported: bool = True
    hls_supported: bool = True
    user_agent: Optional[str] = None


class StrategyDecision(BaseModel):
    strategy: str
    reason: str
    target_format_id: str
    video_stream: Optional[StreamMediaItem] = None
    audio_stream: Optional[StreamMediaItem] = None
    progressive_stream: Optional[StreamMediaItem] = None
    hls_stream: Optional[StreamMediaItem] = None
    ticket_required: bool = False
    estimated_bytes: int = 0


def evaluate_strategy(
    manifest: MediaManifest,
    target_format_id: str,
    target_format_type: str = "video",
    capabilities: Optional[ClientCapabilities] = None
) -> StrategyDecision:
    caps = capabilities or ClientCapabilities()
    target_fid = str(target_format_id).strip()
    worker_relay_disabled = os.environ.get("DISABLE_WORKER_RELAY", "false").lower() == "true"

    # 1. Search in progressive streams
    matching_progressive = next(
        (p for p in manifest.media.progressive if p.format_id == target_fid or p.id == target_fid),
        None
    )
    if matching_progressive:
        est_size = matching_progressive.filesize or 0
        if matching_progressive.relay_required:
            if worker_relay_disabled and manifest.fallback.server_fallback_allowed:
                return StrategyDecision(
                    strategy=StrategyType.SERVER_FALLBACK,
                    reason="Worker relay disabled via configuration; routing to server fallback",
                    target_format_id=target_fid,
                    progressive_stream=matching_progressive,
                    estimated_bytes=est_size
                )
            return StrategyDecision(
                strategy=StrategyType.SIGNED_WORKER_RANGE,
                reason="Progressive stream requiring signed worker range relay",
                target_format_id=target_fid,
                progressive_stream=matching_progressive,
                ticket_required=True,
                estimated_bytes=est_size
            )
        if matching_progressive.range_supported and est_size > 10 * 1024 * 1024:
            return StrategyDecision(
                strategy=StrategyType.DIRECT_RANGE,
                reason="Progressive stream with direct HTTP Range slicing",
                target_format_id=target_fid,
                progressive_stream=matching_progressive,
                estimated_bytes=est_size
            )
        return StrategyDecision(
            strategy=StrategyType.DIRECT_PROGRESSIVE,
            reason="Progressive media stream with direct CDN delivery",
            target_format_id=target_fid,
            progressive_stream=matching_progressive,
            estimated_bytes=est_size
        )

    # 2. Search in audio-only request
    if target_format_type == "audio":
        matching_audio = next(
            (a for a in manifest.media.audio if a.format_id == target_fid or a.id == target_fid),
            None
        ) or (manifest.media.audio[0] if manifest.media.audio else None)

        if matching_audio:
            est_size = matching_audio.filesize or 0
            if matching_audio.relay_required:
                if worker_relay_disabled and manifest.fallback.server_fallback_allowed:
                    return StrategyDecision(
                        strategy=StrategyType.SERVER_FALLBACK,
                        reason="Worker relay disabled via configuration; routing to server fallback",
                        target_format_id=matching_audio.format_id,
                        audio_stream=matching_audio,
                        estimated_bytes=est_size
                    )
                return StrategyDecision(
                    strategy=StrategyType.SIGNED_WORKER_RANGE,
                    reason="Audio stream requiring signed worker range relay",
                    target_format_id=matching_audio.format_id,
                    audio_stream=matching_audio,
                    ticket_required=True,
                    estimated_bytes=est_size
                )
            return StrategyDecision(
                strategy=StrategyType.DIRECT_RANGE if matching_audio.range_supported else StrategyType.DIRECT_PROGRESSIVE,
                reason="Audio-only direct media stream",
                target_format_id=matching_audio.format_id,
                audio_stream=matching_audio,
                estimated_bytes=est_size
            )

    # 3. Search in video streams (Adaptive Mux)
    matching_video = next(
        (v for v in manifest.media.video if v.format_id == target_fid or v.id == target_fid),
        None
    )
    if matching_video:
        # Match an audio stream for in-browser remuxing
        matching_audio = manifest.media.audio[0] if manifest.media.audio else None
        
        # Check if client can perform browser-side remux
        if caps.remux_supported and matching_audio:
            est_size = (matching_video.filesize or 0) + (matching_audio.filesize or 0)
            requires_relay = matching_video.relay_required or matching_audio.relay_required
            if requires_relay and worker_relay_disabled and manifest.fallback.server_fallback_allowed:
                return StrategyDecision(
                    strategy=StrategyType.SERVER_FALLBACK,
                    reason="Worker relay disabled via configuration; routing to server fallback",
                    target_format_id=target_fid,
                    video_stream=matching_video,
                    audio_stream=matching_audio,
                    estimated_bytes=est_size
                )
            strat = StrategyType.SIGNED_WORKER_RANGE if requires_relay else StrategyType.BROWSER_ADAPTIVE_MUX
            reason = (
                "Adaptive streams requiring signed worker range relay and in-browser multiplexing"
                if requires_relay
                else "Adaptive separate video and audio streams multiplexed in-browser"
            )
            return StrategyDecision(
                strategy=strat,
                reason=reason,
                target_format_id=target_fid,
                video_stream=matching_video,
                audio_stream=matching_audio,
                ticket_required=requires_relay,
                estimated_bytes=est_size
            )
        elif manifest.fallback.server_fallback_allowed:
            return StrategyDecision(
                strategy=StrategyType.SERVER_FALLBACK,
                reason="Client remuxing unsupported; fallback to governed server runner",
                target_format_id=target_fid,
                video_stream=matching_video,
                audio_stream=matching_audio,
                estimated_bytes=(matching_video.filesize or 0)
            )

    # 4. Search in HLS streams
    hls_streams = getattr(manifest.media, "hls", [])
    matching_hls = next(
        (h for h in hls_streams if h.format_id == target_fid or h.id == target_fid or target_fid in ("hls", "m3u8")),
        None
    )
    if matching_hls:
        hls_enabled = os.environ.get("NEXUS_BROWSER_HLS_ENABLED", "false").lower() == "true"
        est_size = matching_hls.filesize or 0

        # Check feature flag
        if not hls_enabled:
            if manifest.fallback.server_fallback_allowed:
                return StrategyDecision(
                    strategy=StrategyType.SERVER_FALLBACK,
                    reason="Browser HLS disabled via feature flag; routing to server fallback",
                    target_format_id=target_fid,
                    hls_stream=matching_hls,
                    estimated_bytes=est_size
                )
            return StrategyDecision(
                strategy=StrategyType.UNSUPPORTED,
                reason="Browser HLS disabled via feature flag and server fallback not allowed",
                target_format_id=target_fid
            )

        # Check client browser capabilities
        if not caps.hls_supported or not caps.remux_supported:
            if manifest.fallback.server_fallback_allowed:
                return StrategyDecision(
                    strategy=StrategyType.SERVER_FALLBACK,
                    reason="Client browser lacks HLS/remux capabilities; routing to server fallback",
                    target_format_id=target_fid,
                    hls_stream=matching_hls,
                    estimated_bytes=est_size
                )
            return StrategyDecision(
                strategy=StrategyType.UNSUPPORTED,
                reason="Client browser lacks HLS/remux capabilities",
                target_format_id=target_fid
            )

        # Check unsupported encryption (e.g. SAMPLE-AES or DRM)
        if matching_hls.encryption and matching_hls.encryption.upper() not in ("NONE", "AES-128"):
            if manifest.fallback.server_fallback_allowed:
                return StrategyDecision(
                    strategy=StrategyType.SERVER_FALLBACK,
                    reason=f"Unsupported HLS encryption ({matching_hls.encryption}); routing to server fallback",
                    target_format_id=target_fid,
                    hls_stream=matching_hls,
                    estimated_bytes=est_size
                )
            return StrategyDecision(
                strategy=StrategyType.UNSUPPORTED,
                reason=f"Unsupported HLS encryption ({matching_hls.encryption})",
                target_format_id=target_fid
            )

        # Check unsupported codecs
        codec_str = (matching_hls.codec or "").lower()
        if codec_str and not any(c in codec_str for c in ("h264", "avc", "mp4a", "aac")):
            if manifest.fallback.server_fallback_allowed:
                return StrategyDecision(
                    strategy=StrategyType.SERVER_FALLBACK,
                    reason=f"Unsupported HLS codec ({matching_hls.codec}); routing to server fallback",
                    target_format_id=target_fid,
                    hls_stream=matching_hls,
                    estimated_bytes=est_size
                )
            return StrategyDecision(
                strategy=StrategyType.UNSUPPORTED,
                reason=f"Unsupported HLS codec ({matching_hls.codec})",
                target_format_id=target_fid
            )

        # Supported BROWSER_HLS strategy
        return StrategyDecision(
            strategy=StrategyType.BROWSER_HLS,
            reason="Supported HLS stream selected for in-browser demuxing and remuxing",
            target_format_id=target_fid,
            hls_stream=matching_hls,
            ticket_required=matching_hls.relay_required,
            estimated_bytes=est_size
        )

    # 5. Fallback check: if server fallback allowed
    if manifest.fallback.server_fallback_allowed:
        return StrategyDecision(
            strategy=StrategyType.SERVER_FALLBACK,
            reason="No direct stream candidate matched; routed to server fallback",
            target_format_id=target_fid
        )

    return StrategyDecision(
        strategy=StrategyType.UNSUPPORTED,
        reason=f"No viable execution strategy for format {target_fid}",
        target_format_id=target_fid
    )
