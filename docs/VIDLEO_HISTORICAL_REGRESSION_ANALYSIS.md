# VIDLEO / NEXUS — HISTORICAL REGRESSION ANALYSIS

**Date:** October 11, 2026  
**Repository:** `/home/system/Desktop/Vidleo_intergrated`  

---

## 1. Investigation of Historical Working Capabilities

The project owner reported that Vidleo historically downloaded full-length videos up to approximately 40 minutes long. A thorough audit of the entire Git history was conducted to trace how long-form downloads previously functioned and how the architecture evolved.

### 1.1 Complete Architecture Evolution Timeline

| Era / Commit Range | Commit | Architectural Mechanism | Long-Duration Behavior |
| :--- | :--- | :--- | :--- |
| **Phase 0 Baseline** | `9aa214f` | Synthetic Client Mock + Pure Backend Pipeline | Client simulated downloads; backend downloaded via yt-dlp. |
| **Phase 1-6 Architecture** | `3432117` → `6031d5b` | Cloudflare Worker Relay + `MediaEngine` Streaming MP4 Muxer | Evaluated progressive streams (e.g. format 18, 640x360) and DASH streams via `fetchStreamWithRange` through Cloudflare Relay (`nexus-media-relay`). Tested on up to 10-minute (600s) assets. |
| **Direct Progressive Routing** | `dd2ad0a` → `c628c00` | Browser Acquisition Engine (`browserAcquisitionEngine`) | Direct CDN HTTP Range fetching via browser `fetch` using resolved stream URLs (`quality.streamUrl`). |
| **SABR / Cipher Wall Discovery** | `0956ebb` | Truthful Upstream Boundary Audit | Documented that modern YouTube watch pages hide direct unciphered stream URLs for web client sessions (`BLOCKED_BY_UPSTREAM_CIPHER`). |
| **Playback Capture Pivot** | `00fd260` → `65d7c41` | `HTMLVideoElement.captureStream()` + `MediaRecorder` | Real-time playback capture fallback. Could record live video, but required 1:1 playback time. |
| **CDP Active Player Interception** | `98bbab4` → `6cc7c52` | Chrome DevTools Protocol (`Network.getResponseBody`) | Attached to active YouTube tab to capture authenticated SABR UMP chunks. Intercepted genuine itag 133 / 395 video and 251 audio. |
| **Buffer Advancement & Hardening** | `e06cf3a` → `db6c1e4` | Accelerated Playback Drive Loop (`seekTo` buffer frontier nudges) | Attempted to drive the player through its full duration by nudging the playhead near `bEnd`. |

---

## 2. The Nature of the Regression

### 2.1 The Two Distinct Architecture Generations
1. **The Pre-SABR / Direct Stream Era (Phase 1-6):**
   - Historically, long-form downloads succeeded through direct stream URLs or manifest range fetching (`MediaEngine.execute` / `StreamingMP4Muxer`).
   - Format 18 (progressive MP4 640x360) or direct CDN range URLs were fetched across chunk ranges without player-based buffering limitations.
2. **The Modern SABR / CDP Era:**
   - When modern YouTube locked web client playback behind SABR Protobuf streams (`application/vnd.yt-ump`) and removed direct progressive format URLs from DOM player responses (`window.ytInitialPlayerResponse`), Vidleo introduced the CDP response-body interceptor in commit `98bbab4`.
   - The CDP pipeline functions reliably for short videos ($\le 20$s, e.g. `jNQXAC9IVRw`), but encounters host-enforced buffer windowing on long videos.

### 2.2 Why CDP Acquisition Stalls on Long Videos
- YouTube's DASH scheduler only requests media within a tight forward window (~60.0s).
- Programmatic seeks (`seekTo`) intended to force subsequent chunk downloads cause YouTube to abort in-flight requests (`net::ERR_ABORTED`) or reject them (`403` / `ERR_NAME_NOT_RESOLVED`).
- Furthermore, automated headless playback crossing ~40s without human telemetry triggers YouTube's bot detection teardown (`Something went wrong. Refresh or try again later.`), stripping the video element `src`.

---

## 3. Findings Summary

The historical 40-minute capability did not run on the current CDP drive loop. It was architected on stream range fetching (`MediaEngine.execute` / `fetchStreamWithRange`) before YouTube's transition to SABR-only streaming for web browsers. Attempting to simulate rapid playback of 40-minute videos through CDP `seekTo` nudges is fundamentally blocked by the host platform's buffer scheduler and session telemetry.
