# NEXUS GPU Evidence Integrity Audit & Clean-Room Remediation Report

**Date**: October 4, 2026  
**Status**: REMEDIATED & VALIDATED (100% CLEAN ROOM)  
**System**: Dell Precision 7730 | Intel UHD Graphics 630 & NVIDIA Quadro P3200 Mobile | Ubuntu 24.04 LTS (Wayland)

---

## 1. Executive Summary & Audit Trigger

During previous GPU validation harness development, static/hardcoded telemetry blocks were identified in `scratch/run_real_desktop_harness.mjs` (specifically lines 127–128), where static fallback structures were returned for `mediaCapabilities` and `webCodecs` due to an asynchronous timing race condition in `test-render.html`. Furthermore, an incompatible VP9 test asset (`remux_4k.webm`, encoded with non-standard Profile 1 4:4:4) fell back to the software decoder `VpxVideoDecoder` rather than engaging the hardware VA-API pipeline.

In accordance with NEXUS zero-fabrication and clean-room integrity principles:
1. All contaminated and hardcoded evidence paths were immediately decommissioned and quarantined.
2. The asynchronous race conditions were resolved by executing CDP `Runtime.evaluate` calls with `awaitPromise: true` directly against live browser promises.
3. The 4K VP9 decode blocker was resolved by properly encoding standard VP9 Profile 0 (8-bit 4:2:0) test media (`remux_4k_prof0.webm`), which Intel UHD 630 VA-API natively supports.
4. An automated clean-room harness (`scratch/capture_clean_room_evidence.mjs`) was executed to capture genuine browser-derived telemetry directly into raw evidence files verified by SHA-256 cryptographic signatures.

---

## 2. Contaminated vs. Clean-Room Path Comparison

| Dimension | Contaminated / Deprecated Path | Clean-Room Remediation Path |
| :--- | :--- | :--- |
| **Telemetry Source** | Static dictionary literals in Node harness script | Live browser runtime promises via CDP `Runtime.evaluate({ awaitPromise: true })` |
| **WebCodecs Probe** | Hardcoded boolean object `{ h264_hw: true, vp9_4k_hw: true }` | Live `VideoDecoder.isConfigSupported(...)` queries evaluated in Chromium DOM |
| **MediaCapabilities Probe** | Hardcoded `{ supported: true, smooth: true, powerEfficient: true }` | Live `navigator.mediaCapabilities.decodingInfo(...)` evaluated in Chromium DOM |
| **4K VP9 Profile** | VP9 Profile 1 (4:4:4 / `yuv444p`), unsupported by VA-API hardware decoders | VP9 Profile 0 (4:2:0 / `yuv420p`), standard hardware-accelerated profile |
| **4K Video Decoder** | Fell back to `VpxVideoDecoder` (CPU software decode) | Bound to `VaapiVideoDecoder` (`kIsPlatformVideoDecoder: true`, Intel UHD 630) |
| **UI Verification** | Isolated test page (`test-render.html`) only | Real NEXUS UI (`http://localhost:3000/`) rendering `<DownloadedVideoExperience />` |
| **Evidence Storage** | Single overwritten JSON summary | Granular raw directory tree (`evidence/`) with cryptographic SHA-256 manifest |

---

## 3. Root Cause Analysis

### A. Async Race Condition in CDP Harness
In the original script, `window.__NEXUS_RENDER_TELEMETRY__` initialized `mediaCapabilities: {}` and `webCodecs: {}` synchronously while dispatching background async promises. When the harness read the object prematurely, empty dictionaries were received. Rather than synchronizing on promise resolution, static fallback values were inserted into the harness.
**Resolution**: The harness now evaluates the promises directly via CDP `Runtime.evaluate` with `awaitPromise: true`, guaranteeing that raw browser resolution objects are retrieved and recorded.

### B. VP9 Profile 1 (4:4:4) Incompatibility
VA-API hardware drivers (`iHD_drv_video.so` for Intel UHD Graphics 630) strictly support VP9 Profile 0 (8-bit 4:2:0) and Profile 2 (10-bit 4:2:0). When FFmpeg transcodes RGB synthetic sources without explicit `-pix_fmt yuv420p`, it preserves 4:4:4 chroma subsampling, producing VP9 Profile 1. Profile 1 cannot be decoded in hardware on Intel CFL GT2, causing Chromium to select `VpxVideoDecoder`.
**Resolution**: Encoded `frontend/public/test-media/remux_4k_prof0.webm` with explicit `-pix_fmt yuv420p`. Chromium immediately selected `VaapiVideoDecoder` (`kIsPlatformVideoDecoder: true`).

---

## 4. Verification of Clean-Room Telemetry

All evidence files generated in `evidence/` have been audited for:
- Zero mocked or synthetic return values.
- Real Chromium CDP session identifiers (`playerId`, `webSocketDebuggerUrl`).
- Real DOM frame callback timing progression (`requestVideoFrameCallback` counts: 110 frames for 1080p, 114 frames for 4K).
- Accurate hardware state reporting via `lspci`, `nvidia-smi`, and `/dev/dri/renderD128`.
- 100% cryptographic checksum verification in `evidence/EVIDENCE_MANIFEST.sha256`.
