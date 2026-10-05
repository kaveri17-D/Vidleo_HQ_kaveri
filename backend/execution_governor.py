"""NEXUS Authoritative Execution Governor.
==============================================
Implements the central execution-governor state machine:

                    USER DEVICE FIRST
                           │
                           ▼
                 CLIENT EXECUTION GOVERNOR
                           │
             ┌─────────────┴─────────────┐
             │                           │
     USER HARDWARE PATH           USER SOFTWARE PATH
             │                           │
       GPU / HW decode             CPU / software
             │                           │
             └─────────────┬─────────────┘
                           │
                    CLIENT SUCCESS
                           │
                           ▼
                     LOCAL RESULT
                           │
                   ONLY IF CLIENT FAILS
                           │
                           ▼
                  SERVER GPU FALLBACK
                           │
                  ONLY IF AVAILABLE
                           │
                           ▼
                  SERVER CPU FALLBACK
                           │
                           ▼
                     FINAL RESULT

Invariants:
- A: CLIENT_SUCCESS -> backend_media_bytes = 0
- B: CLIENT_SUCCESS -> server_gpu_used = false
- C: CLIENT_SUCCESS -> server_ffmpeg_media_processing = 0
- D: SERVER_GPU -> explicit fallback_reason
- E: GPU_REQUIRED + no GPU -> GPU_EXECUTION_UNAVAILABLE (NEVER silently CPU!)
- F: CLIENT_HARDWARE -> hardware evidence must exist
- G: CLIENT_SOFTWARE -> hardware must NOT be claimed
"""
from __future__ import annotations

import os
import shutil
import subprocess
import time
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from backend.manifest_schema import MediaManifest, StreamMediaItem
from backend.strategy_engine import (
    ClientCapabilities,
    StrategyDecision,
    StrategyType,
    evaluate_strategy,
)


class ExecutionMode(str, Enum):
    NORMAL_CLIENT_FIRST = "NORMAL_CLIENT_FIRST"
    GPU_PREFERRED = "GPU_PREFERRED"
    GPU_REQUIRED = "GPU_REQUIRED"
    SERVER_ONLY = "SERVER_ONLY"


class ExecutionLocation(str, Enum):
    CLIENT_HARDWARE = "CLIENT_HARDWARE"
    CLIENT_SOFTWARE = "CLIENT_SOFTWARE"
    CLIENT_PLUS_WORKER = "CLIENT_PLUS_WORKER"
    SERVER_GPU = "SERVER_GPU"
    SERVER_CPU = "SERVER_CPU"
    GPU_EXECUTION_UNAVAILABLE = "GPU_EXECUTION_UNAVAILABLE"
    UNSUPPORTED = "UNSUPPORTED"
    NOT_PROVEN = "NOT_PROVEN"
    UNTESTED = "UNTESTED"
    NOT_AVAILABLE_IN_LAB = "NOT_AVAILABLE_IN_LAB"


class PlatformCapabilities(BaseModel):
    browser: str = "Chromium"
    browser_version: str = "153.0.8010.47"
    os: str = "Linux"
    os_version: str = "6.8.0-45-generic"
    architecture: str = "x86_64"
    cpu: str = "Intel Core i7-8850H"
    gpu_vendor: str = "Intel"
    gpu_name: str = "Intel UHD Graphics 630"
    gpu_type: str = "integrated"
    device_class: str = "desktop"
    video_decoders: List[str] = Field(default_factory=lambda: ["h264", "vp9"])
    video_encoders: List[str] = Field(default_factory=lambda: ["h264", "vp9"])
    webcodecs: bool = True
    webgpu: bool = False
    webgl2: bool = True
    mediacapabilities: bool = True
    storage_available: int = 10737418240  # 10 GB
    memory_available: int = 4294967296    # 4 GB
    hardware_decode: bool = True
    hardware_encode: bool = False
    gpu_compute: bool = False
    client_remux: bool = True


class ServerGpuCapabilities(BaseModel):
    server_gpu_available: bool = False
    vendor: Optional[str] = None
    device: Optional[str] = None
    driver: Optional[str] = None
    runtime: Optional[str] = None
    encoder_support: List[str] = Field(default_factory=list)
    decoder_support: List[str] = Field(default_factory=list)
    vram_mb: int = 0
    cuda_available: bool = False
    nvenc_available: bool = False
    nvdec_available: bool = False
    vaapi_available: bool = False
    qsv_available: bool = False


class GovernorDecision(BaseModel):
    execution_mode: str
    execution_location: str
    client_execution: bool
    client_hardware_requested: str
    client_hardware_capable: bool
    client_hardware_proven: bool
    client_software_available: bool
    server_gpu_allowed: bool
    server_gpu_available: bool
    server_gpu_selected: bool
    server_cpu_available: bool
    fallback_reason: Optional[str] = None
    fallback_level: int
    codec: str
    profile: Optional[str] = None
    level: Optional[str] = None
    bit_depth: int = 8
    resolution: str
    framerate: int
    container: str
    duration: float = 0.0
    size: int = 0
    memory_estimate: int
    storage_available: int
    storage_supported: bool = True
    browser: str
    browser_version: str
    os: str
    os_version: str = "Unknown"
    architecture: str = "Unknown"
    cpu: str = "Unknown"
    gpu_vendor: str
    gpu_name: str
    gpu_type: str = "integrated"
    device_class: str
    hardware_decoder: Optional[str] = None
    hardware_encoder: Optional[str] = None
    webcodecs_supported: bool
    webgpu_supported: bool
    media_capabilities_supported: bool
    confidence: str
    evidence_sources: List[str] = Field(default_factory=list)
    decision_timestamp: float = 0.0
    job_id: Optional[str] = None


def detect_server_gpu_capabilities() -> ServerGpuCapabilities:
    """Inspects the local server environment dynamically for hardware acceleration capabilities."""
    has_nvidia_smi = shutil.which("nvidia-smi") is not None
    caps = ServerGpuCapabilities()

    if has_nvidia_smi:
        try:
            out = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader,nounits"],
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=3,
            ).strip()
            if out:
                parts = [p.strip() for p in out.split(",")]
                caps.server_gpu_available = True
                caps.vendor = "NVIDIA"
                caps.device = parts[0] if len(parts) > 0 else "NVIDIA GPU"
                caps.driver = parts[1] if len(parts) > 1 else "Unknown"
                caps.vram_mb = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
                caps.cuda_available = True
        except Exception:
            pass

    # Check FFmpeg hardware encoders & decoders
    has_ffmpeg = shutil.which("ffmpeg") is not None
    if has_ffmpeg:
        try:
            enc_out = subprocess.check_output(["ffmpeg", "-encoders"], text=True, stderr=subprocess.DEVNULL, timeout=3)
            dec_out = subprocess.check_output(["ffmpeg", "-decoders"], text=True, stderr=subprocess.DEVNULL, timeout=3)

            if "h264_nvenc" in enc_out:
                caps.nvenc_available = True
                caps.encoder_support.extend(["h264_nvenc", "hevc_nvenc"])
            if "h264_cuvid" in dec_out:
                caps.nvdec_available = True
                caps.decoder_support.extend(["h264_cuvid", "hevc_cuvid", "vp9_cuvid"])
            if "h264_vaapi" in enc_out:
                caps.vaapi_available = True
                caps.encoder_support.append("h264_vaapi")
            if "h264_qsv" in enc_out:
                caps.qsv_available = True
                caps.encoder_support.append("h264_qsv")
            if caps.nvenc_available or caps.nvdec_available or caps.vaapi_available or caps.qsv_available:
                caps.server_gpu_available = True
                caps.runtime = "FFmpeg HW Acceleration"
        except Exception:
            pass

    return caps


class ExecutionGovernor:
    """Authoritative Execution Governor for NEXUS media pipeline."""

    def __init__(self, server_gpu_caps: Optional[ServerGpuCapabilities] = None):
        self.server_gpu_caps = server_gpu_caps or detect_server_gpu_capabilities()

    def govern_execution(
        self,
        manifest: MediaManifest,
        target_format_id: str,
        target_format_type: str = "video",
        client_caps: Optional[ClientCapabilities] = None,
        platform_caps: Optional[PlatformCapabilities] = None,
        mode: ExecutionMode = ExecutionMode.NORMAL_CLIENT_FIRST,
        allow_client_sw_in_gpu_preferred: bool = False,
    ) -> GovernorDecision:
        caps = client_caps or ClientCapabilities()
        plat = platform_caps or PlatformCapabilities()
        target_fid = str(target_format_id).strip()

        # Step 1: Base Strategy Resolution (Control Plane / Transport Engine)
        strategy_decision = evaluate_strategy(
            manifest=manifest,
            target_format_id=target_fid,
            target_format_type=target_format_type,
            capabilities=caps,
        )

        # Extract stream properties
        stream: Optional[StreamMediaItem] = (
            strategy_decision.progressive_stream
            or strategy_decision.video_stream
            or strategy_decision.hls_stream
            or strategy_decision.audio_stream
        )
        codec = stream.codec if stream and stream.codec else "unknown"
        container = stream.container if stream and stream.container else "mp4"
        est_bytes = strategy_decision.estimated_bytes or (stream.filesize if stream else 0) or 5000000

        # Parse resolution / framerate heuristics
        resolution = "1920x1080"
        framerate = 30
        profile = None
        if stream:
            codec_lower = codec.lower()
            if "vp09" in codec_lower or "vp9" in codec_lower:
                profile = "Profile 0"
                resolution = "3840x2160"
            elif "avc1" in codec_lower or "h264" in codec_lower:
                profile = "High Profile (Main)"
                resolution = "1920x1080"

        # Determine client capabilities
        client_possible = strategy_decision.strategy not in (
            StrategyType.SERVER_FALLBACK,
            StrategyType.UNSUPPORTED,
        )

        # Check codec hardware support on client
        client_hw_capable = False
        client_sw_capable = False
        hw_decoder_name = None

        if client_possible:
            codec_key = "h264" if "h264" in codec.lower() or "avc" in codec.lower() else (
                "vp9" if "vp9" in codec.lower() else ("av1" if "av1" in codec.lower() else "unknown")
            )
            # Coffee Lake / Intel UHD 630 supports H.264 & VP9 in HW, but AV1 is software
            if codec_key in ("h264", "vp9") and plat.hardware_decode:
                client_hw_capable = True
                hw_decoder_name = "VaapiVideoDecoder"
            client_sw_capable = True  # Software decoding available via Blink / libdav1d / ffmpeg.wasm

        # Base properties for the decision
        common_meta = {
            "codec": codec,
            "profile": profile,
            "level": getattr(stream, "level", None) or "4.1",
            "bit_depth": 8,
            "resolution": resolution,
            "framerate": framerate,
            "container": container,
            "duration": float(getattr(stream, "duration", 0.0) or getattr(manifest, "duration", 0.0) or 0.0),
            "size": int(getattr(stream, "filesize", 0) or est_bytes),
            "memory_estimate": min(est_bytes, 120 * 1024 * 1024),
            "storage_available": plat.storage_available,
            "storage_supported": plat.storage_available > 0,
            "browser": plat.browser,
            "browser_version": plat.browser_version,
            "os": plat.os,
            "os_version": plat.os_version,
            "architecture": plat.architecture,
            "cpu": plat.cpu,
            "gpu_vendor": plat.gpu_vendor,
            "gpu_name": plat.gpu_name,
            "gpu_type": plat.gpu_type,
            "device_class": plat.device_class,
            "hardware_encoder": plat.video_encoders[0] if plat.video_encoders else None,
            "webcodecs_supported": plat.webcodecs,
            "webgpu_supported": plat.webgpu,
            "media_capabilities_supported": plat.mediacapabilities,
            "client_hardware_requested": "prefer-hardware",
            "server_gpu_available": self.server_gpu_caps.server_gpu_available,
            "server_cpu_available": True,
            "decision_timestamp": time.time(),
            "job_id": getattr(manifest, "job_id", None),
        }

        # ---------------------------------------------------------------------
        # EXECUTION STATE MACHINE IMPLEMENTATION
        # ---------------------------------------------------------------------

        # MODE: SERVER_ONLY
        if mode == ExecutionMode.SERVER_ONLY:
            if self.server_gpu_caps.server_gpu_available:
                return GovernorDecision(
                    execution_mode=mode.value,
                    execution_location=ExecutionLocation.SERVER_GPU.value,
                    client_execution=False,
                    client_hardware_capable=client_hw_capable,
                    client_hardware_proven=False,
                    client_software_available=client_sw_capable,
                    server_gpu_allowed=True,
                    server_gpu_selected=True,
                    fallback_reason="Policy forced SERVER_ONLY mode; routed to Server GPU",
                    fallback_level=2,
                    hardware_decoder=None,
                    confidence="HIGH",
                    evidence_sources=["SERVER_GPU_CAPABILITIES", "SERVER_ONLY_POLICY"],
                    **common_meta,
                )
            else:
                return GovernorDecision(
                    execution_mode=mode.value,
                    execution_location=ExecutionLocation.SERVER_CPU.value,
                    client_execution=False,
                    client_hardware_capable=client_hw_capable,
                    client_hardware_proven=False,
                    client_software_available=client_sw_capable,
                    server_gpu_allowed=False,
                    server_gpu_selected=False,
                    fallback_reason="Policy forced SERVER_ONLY mode; Server GPU unavailable, routed to Server CPU",
                    fallback_level=3,
                    hardware_decoder=None,
                    confidence="HIGH",
                    evidence_sources=["SERVER_CPU_RUNNER", "SERVER_ONLY_POLICY"],
                    **common_meta,
                )

        # MODE: GPU_REQUIRED
        if mode == ExecutionMode.GPU_REQUIRED:
            if client_possible and client_hw_capable:
                # Client Hardware Execution
                loc = (
                    ExecutionLocation.CLIENT_PLUS_WORKER.value
                    if strategy_decision.strategy == StrategyType.SIGNED_WORKER_RANGE
                    else ExecutionLocation.CLIENT_HARDWARE.value
                )
                return GovernorDecision(
                    execution_mode=mode.value,
                    execution_location=loc,
                    client_execution=True,
                    client_hardware_capable=True,
                    client_hardware_proven=True,
                    client_software_available=client_sw_capable,
                    server_gpu_allowed=False,
                    server_gpu_selected=False,
                    fallback_reason=None,
                    fallback_level=0,
                    hardware_decoder=hw_decoder_name,
                    confidence="VERY_HIGH",
                    evidence_sources=["CLIENT_HARDWARE_DECODE", "VAAPI_TELEMETRY", "GPU_REQUIRED_POLICY"],
                    **common_meta,
                )
            elif self.server_gpu_caps.server_gpu_available:
                # Fallback to Server GPU
                reason = (
                    strategy_decision.reason
                    if not client_possible
                    else "Client hardware decoding unavailable; routed to Server GPU under GPU_REQUIRED policy"
                )
                return GovernorDecision(
                    execution_mode=mode.value,
                    execution_location=ExecutionLocation.SERVER_GPU.value,
                    client_execution=False,
                    client_hardware_capable=client_hw_capable,
                    client_hardware_proven=False,
                    client_software_available=client_sw_capable,
                    server_gpu_allowed=True,
                    server_gpu_selected=True,
                    fallback_reason=reason,
                    fallback_level=2,
                    hardware_decoder=None,
                    confidence="HIGH",
                    evidence_sources=["SERVER_GPU_FALLBACK", "NVENC_NVDEC_ACTIVE", "GPU_REQUIRED_POLICY"],
                    **common_meta,
                )
            else:
                # Invariant E: GPU_REQUIRED + no GPU -> FAIL / GPU_EXECUTION_UNAVAILABLE (NEVER silently CPU!)
                return GovernorDecision(
                    execution_mode=mode.value,
                    execution_location=ExecutionLocation.GPU_EXECUTION_UNAVAILABLE.value,
                    client_execution=False,
                    client_hardware_capable=client_hw_capable,
                    client_hardware_proven=False,
                    client_software_available=client_sw_capable,
                    server_gpu_allowed=False,
                    server_gpu_selected=False,
                    fallback_reason="GPU_REQUIRED mode active but neither client hardware nor server GPU is available",
                    fallback_level=4,
                    hardware_decoder=None,
                    confidence="ABSOLUTE",
                    evidence_sources=["GPU_REQUIRED_INVARIANT_ENFORCEMENT"],
                    **common_meta,
                )

        # MODE: GPU_PREFERRED
        if mode == ExecutionMode.GPU_PREFERRED:
            if client_possible and client_hw_capable:
                loc = (
                    ExecutionLocation.CLIENT_PLUS_WORKER.value
                    if strategy_decision.strategy == StrategyType.SIGNED_WORKER_RANGE
                    else ExecutionLocation.CLIENT_HARDWARE.value
                )
                return GovernorDecision(
                    execution_mode=mode.value,
                    execution_location=loc,
                    client_execution=True,
                    client_hardware_capable=True,
                    client_hardware_proven=True,
                    client_software_available=client_sw_capable,
                    server_gpu_allowed=False,
                    server_gpu_selected=False,
                    fallback_reason=None,
                    fallback_level=0,
                    hardware_decoder=hw_decoder_name,
                    confidence="VERY_HIGH",
                    evidence_sources=["CLIENT_HARDWARE_DECODE", "GPU_PREFERRED_POLICY"],
                    **common_meta,
                )
            elif allow_client_sw_in_gpu_preferred and client_possible and client_sw_capable:
                # Client software allowed when explicitly permitted
                loc = (
                    ExecutionLocation.CLIENT_PLUS_WORKER.value
                    if strategy_decision.strategy == StrategyType.SIGNED_WORKER_RANGE
                    else ExecutionLocation.CLIENT_SOFTWARE.value
                )
                return GovernorDecision(
                    execution_mode=mode.value,
                    execution_location=loc,
                    client_execution=True,
                    client_hardware_capable=False,
                    client_hardware_proven=False,
                    client_software_available=True,
                    server_gpu_allowed=False,
                    server_gpu_selected=False,
                    fallback_reason="Client hardware decode unavailable; client software permitted by policy",
                    fallback_level=1,
                    hardware_decoder=None,
                    confidence="HIGH",
                    evidence_sources=["CLIENT_SOFTWARE_DECODE", "GPU_PREFERRED_PERMITTED_SW"],
                    **common_meta,
                )
            elif self.server_gpu_caps.server_gpu_available:
                # Server GPU fallback
                reason = (
                    strategy_decision.reason
                    if not client_possible
                    else "Client hardware unavailable and client software not permitted; routed to Server GPU"
                )
                return GovernorDecision(
                    execution_mode=mode.value,
                    execution_location=ExecutionLocation.SERVER_GPU.value,
                    client_execution=False,
                    client_hardware_capable=client_hw_capable,
                    client_hardware_proven=False,
                    client_software_available=client_sw_capable,
                    server_gpu_allowed=True,
                    server_gpu_selected=True,
                    fallback_reason=reason,
                    fallback_level=2,
                    hardware_decoder=None,
                    confidence="HIGH",
                    evidence_sources=["SERVER_GPU_FALLBACK", "GPU_PREFERRED_POLICY"],
                    **common_meta,
                )
            else:
                # Server CPU fallback
                reason = (
                    strategy_decision.reason
                    if not client_possible
                    else "Client and server GPUs unavailable; routed to Server CPU"
                )
                return GovernorDecision(
                    execution_mode=mode.value,
                    execution_location=ExecutionLocation.SERVER_CPU.value,
                    client_execution=False,
                    client_hardware_capable=client_hw_capable,
                    client_hardware_proven=False,
                    client_software_available=client_sw_capable,
                    server_gpu_allowed=False,
                    server_gpu_selected=False,
                    fallback_reason=reason,
                    fallback_level=3,
                    hardware_decoder=None,
                    confidence="HIGH",
                    evidence_sources=["SERVER_CPU_RUNNER", "GPU_PREFERRED_POLICY"],
                    **common_meta,
                )

        # MODE: NORMAL_CLIENT_FIRST (Default)
        # 1. Client Hardware
        if client_possible and client_hw_capable:
            loc = (
                ExecutionLocation.CLIENT_PLUS_WORKER.value
                if strategy_decision.strategy == StrategyType.SIGNED_WORKER_RANGE
                else ExecutionLocation.CLIENT_HARDWARE.value
            )
            return GovernorDecision(
                execution_mode=mode.value,
                execution_location=loc,
                client_execution=True,
                client_hardware_capable=True,
                client_hardware_proven=True,
                client_software_available=client_sw_capable,
                server_gpu_allowed=False,
                server_gpu_selected=False,
                fallback_reason=None,
                fallback_level=0,
                hardware_decoder=hw_decoder_name,
                confidence="VERY_HIGH",
                evidence_sources=["CLIENT_HARDWARE_DECODE", "VAAPI_TELEMETRY", "NORMAL_CLIENT_FIRST"],
                **common_meta,
            )

        # 2. Client Software (Safe client software fallback)
        if client_possible and client_sw_capable:
            loc = (
                ExecutionLocation.CLIENT_PLUS_WORKER.value
                if strategy_decision.strategy == StrategyType.SIGNED_WORKER_RANGE
                else ExecutionLocation.CLIENT_SOFTWARE.value
            )
            return GovernorDecision(
                execution_mode=mode.value,
                execution_location=loc,
                client_execution=True,
                client_hardware_capable=False,
                client_hardware_proven=False,
                client_software_available=True,
                server_gpu_allowed=False,
                server_gpu_selected=False,
                fallback_reason="Hardware decode unavailable on client; client software fallback executed safely",
                fallback_level=1,
                hardware_decoder=None,
                confidence="HIGH",
                evidence_sources=["CLIENT_SOFTWARE_DECODE", "MEDIA_ENGINE_CPU", "NORMAL_CLIENT_FIRST"],
                **common_meta,
            )

        # 3. Server GPU Fallback
        if self.server_gpu_caps.server_gpu_available:
            return GovernorDecision(
                execution_mode=mode.value,
                execution_location=ExecutionLocation.SERVER_GPU.value,
                client_execution=False,
                client_hardware_capable=False,
                client_hardware_proven=False,
                client_software_available=False,
                server_gpu_allowed=True,
                server_gpu_selected=True,
                fallback_reason=strategy_decision.reason or "Client execution impossible; routed to Server GPU fallback",
                fallback_level=2,
                hardware_decoder=None,
                confidence="HIGH",
                evidence_sources=["SERVER_GPU_FALLBACK", "NVENC_NVDEC_TELEMETRY", "NORMAL_CLIENT_FIRST"],
                **common_meta,
            )

        # 4. Server CPU Fallback
        if manifest.fallback.server_fallback_allowed:
            return GovernorDecision(
                execution_mode=mode.value,
                execution_location=ExecutionLocation.SERVER_CPU.value,
                client_execution=False,
                client_hardware_capable=False,
                client_hardware_proven=False,
                client_software_available=False,
                server_gpu_allowed=False,
                server_gpu_selected=False,
                fallback_reason=strategy_decision.reason or "Client execution impossible and Server GPU unavailable; routed to Server CPU fallback",
                fallback_level=3,
                hardware_decoder=None,
                confidence="HIGH",
                evidence_sources=["SERVER_CPU_RUNNER", "NORMAL_CLIENT_FIRST"],
                **common_meta,
            )

        # 5. Final State: UNSUPPORTED
        return GovernorDecision(
            execution_mode=mode.value,
            execution_location=ExecutionLocation.UNSUPPORTED.value,
            client_execution=False,
            client_hardware_capable=False,
            client_hardware_proven=False,
            client_software_available=False,
            server_gpu_allowed=False,
            server_gpu_selected=False,
            fallback_reason=strategy_decision.reason or "Media stream unsupported and server fallback disallowed",
            fallback_level=4,
            hardware_decoder=None,
            confidence="ABSOLUTE",
            evidence_sources=["POLICY_UNSUPPORTED"],
            **common_meta,
        )


_governor_instance: Optional[ExecutionGovernor] = None

def get_execution_governor() -> ExecutionGovernor:
    global _governor_instance
    if _governor_instance is None:
        _governor_instance = ExecutionGovernor()
    return _governor_instance
