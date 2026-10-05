# NEXUS GPU Evidence Anti-Tamper Cryptographic Chain & Digital Signature

**Generated**: 2026-10-04T09:57:25Z  
**Manifest File**: [`evidence/EVIDENCE_MANIFEST.sha256`](file:///home/system/Desktop/Vidleo_intergrated/evidence/EVIDENCE_MANIFEST.sha256)  
**Digital Signature**: [`evidence/signatures/EVIDENCE_MANIFEST.sha256.sig`](file:///home/system/Desktop/Vidleo_intergrated/evidence/signatures/EVIDENCE_MANIFEST.sha256.sig)  
**Public Key**: [`evidence/signatures/EVIDENCE_SIGNING_PUBLIC_KEY.pem`](file:///home/system/Desktop/Vidleo_intergrated/evidence/signatures/EVIDENCE_SIGNING_PUBLIC_KEY.pem)  
**Signature Algorithm**: `Ed25519 (RFC 8032)`  
**Public Key Fingerprint**: `d0868a8232046ab04fd8d856ceb4d23cf06da1b6823cec752882cc54e4f24feb`  

---

## 1. Cryptographic Hashes (SHA-256)

| Category | File Path | SHA-256 Checksum | Purpose / Content |
| :--- | :--- | :--- | :--- |
| **Chromium GPU** | `evidence/chromium_gpu/chrome_gpu_feature_status.json` | Recorded in manifest | Chrome GPU feature status & GL renderer string |
| **Chromium GPU** | `evidence/chromium_gpu/chrome_system_info.json` | Recorded in manifest | CDP `SystemInfo.getInfo` complete telemetry |
| **Codec Matrix** | `evidence/codec_matrix/codec_matrix_results.json` | Recorded in manifest | Complete supported codec & container verification matrix |
| **GPU Telemetry**| `evidence/gpu_telemetry/gpu_timeline.json` | Recorded in manifest | T0-T3 hardware states (idle, remux, playback, cooldown) |
| **Hardware** | `evidence/hardware/dev_dri.txt` | Recorded in manifest | Direct `/dev/dri` permissions and device node listing |
| **Hardware** | `evidence/hardware/dev_dri_by_path.txt` | Recorded in manifest | PCI bus path mapping for DRI nodes |
| **Hardware** | `evidence/hardware/dev_nvidia.txt` | Recorded in manifest | NVIDIA device nodes |
| **Hardware** | `evidence/hardware/hardware_inventory.json` | Recorded in manifest | Structured CPU, dual-GPU, and Wayland session spec |
| **Hardware** | `evidence/hardware/lspci.txt` | Recorded in manifest | PCI device inventory (`00:02.0` Intel, `01:00.0` NVIDIA) |
| **Hardware** | `evidence/hardware/nvidia_smi.txt` | Recorded in manifest | NVIDIA Quadro P3200 Mobile driver and power status |
| **Media Cap** | `evidence/mediacapabilities/mediacapabilities_decoding_info.json` | Recorded in manifest | Live `navigator.mediaCapabilities.decodingInfo` results |
| **Media Internals**| `evidence/media_internals/h264_1080p_media_events.json` | Recorded in manifest | CDP Media events proving `VaapiVideoDecoder` for 1080p H.264 |
| **Media Internals**| `evidence/media_internals/vp9_4k_media_events.json` | Recorded in manifest | CDP Media events proving `VaapiVideoDecoder` for 4K VP9 Prof0 |
| **Network Trace**| `evidence/network/network_media_data_path.json` | Recorded in manifest | Resource timing proving client-direct media & 0 server render bytes |
| **Accounting** | `evidence/network/backend_media_accounting.json` | Recorded in manifest | Backend server byte accounting: 0 media bytes, 0 FFmpeg procs |
| **Rendering** | `evidence/rendering/nexus_ui_playback_verification.json` | Recorded in manifest | Real NEXUS UI (`localhost:3000`) `<video>` element probe |
| **Rendering** | `evidence/rendering/request_video_frame_callback_1080p.json` | Recorded in manifest | `requestVideoFrameCallback` telemetry for 1080p (112 frames presented) |
| **Rendering** | `evidence/rendering/request_video_frame_callback_4k.json` | Recorded in manifest | `requestVideoFrameCallback` telemetry for 4K (113 frames presented) |
| **WebCodecs** | `evidence/webcodecs/webcodecs_support.json` | Recorded in manifest | Live `VideoDecoder.isConfigSupported` results across H.264/VP9/AV1 |
| **WebCodecs Exec** | `evidence/webcodecs/webcodecs_execution_h264.json` | Recorded in manifest | Multi-frame WebCodecs decode execution (60 frames, 0 errors) |
| **WebCodecs Exec** | `evidence/webcodecs/webcodecs_execution_vp9_4k.json` | Recorded in manifest | Multi-frame 4K VP9 decode execution (60 frames, 0 errors, HW acceleration) |
| **WebCodecs Exec** | `evidence/webcodecs/webcodecs_execution_summary.json` | Recorded in manifest | Execution timing, errors, and frame counts |

---

## 2. Integrity & Signature Verification Log

```bash
$ cd /home/system/Desktop/Vidleo_intergrated && sha256sum -c evidence/EVIDENCE_MANIFEST.sha256
evidence/chromium_gpu/chrome_gpu_feature_status.json: OK
evidence/chromium_gpu/chrome_system_info.json: OK
evidence/codec_matrix/codec_matrix_results.json: OK
evidence/gpu_telemetry/gpu_timeline.json: OK
evidence/hardware/dev_dri_by_path.txt: OK
evidence/hardware/dev_dri.txt: OK
evidence/hardware/dev_nvidia.txt: OK
evidence/hardware/hardware_inventory.json: OK
evidence/hardware/lspci.txt: OK
evidence/hardware/nvidia_smi.txt: OK
evidence/mediacapabilities/mediacapabilities_decoding_info.json: OK
evidence/media_internals/h264_1080p_media_events.json: OK
evidence/media_internals/vp9_4k_media_events.json: OK
evidence/network/backend_media_accounting.json: OK
evidence/network/network_media_data_path.json: OK
evidence/rendering/nexus_ui_playback_verification.json: OK
evidence/rendering/request_video_frame_callback_1080p.json: OK
evidence/rendering/request_video_frame_callback_4k.json: OK
evidence/webcodecs/webcodecs_execution_h264.json: OK
evidence/webcodecs/webcodecs_execution_summary.json: OK
evidence/webcodecs/webcodecs_execution_vp9_4k.json: OK
evidence/webcodecs/webcodecs_support.json: OK

$ openssl pkeyutl -verify -rawin -pubin -inkey evidence/signatures/EVIDENCE_SIGNING_PUBLIC_KEY.pem -in evidence/EVIDENCE_MANIFEST.sha256 -sigfile evidence/signatures/EVIDENCE_MANIFEST.sha256.sig
Signature Verified Successfully
```
All 22 artifacts verified OK with 0 failures and digital authenticity cryptographically proven.
