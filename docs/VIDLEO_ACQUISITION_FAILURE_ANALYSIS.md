# VIDLEO / NEXUS — ACQUISITION FAILURE ANALYSIS

**Date:** October 11, 2026  
**Repository:** `/home/system/Desktop/Vidleo_intergrated`  
**Test Assets Evaluated:**
- Short Reference Video: `jNQXAC9IVRw` (19.013 seconds) — **PASS**
- Full-Length Test Video: `09R8_2nJtjg` (301.381 seconds) — **FAIL**

---

## 1. Diagnostic Summary Table

| Stage | Expected Behavior | Observed Behavior | Status |
| :--- | :--- | :--- | :---: |
| **1. CDP Attach** | Extension attaches `chrome.debugger` to tab | Successfully attached to YouTube tab | **PASS** |
| **2. Media Detection** | Intercept `videoplayback` / `yt-ump` requests | Successfully detected initial SABR requests (`rn=1`..`6`) | **PASS** |
| **3. Chunk Acquisition** | Retrieve Base64 binary response bodies | Acquired ~2.62 MB of valid initial UMP chunks | **PASS** |
| **4. UMP Demuxing** | Parse protobuf header and extract video/audio | Valid parsing of AV1/H264 & Opus frames | **PASS** |
| **5. Buffer Frontier** | Advance buffer beyond 60s towards full length | Hard ceiling at 60.0s; subsequent requests aborted | **FAIL** |
| **6. Continuous Playback** | Natural 2x playback past 40 seconds | Player teardown: "Something went wrong" at t ≈ 40s | **FAIL** |

---

## 2. Failure Classification Matrix

| Failure Classification | Evidence Assessment | Status |
| :--- | :--- | :---: |
| `ROUTING_ERROR` | Evaluated in `VideoDetectedCard.tsx`. Reconnected in recent commit. | **RESOLVED** |
| `STRATEGY_UNAVAILABLE` | Extension detected and responsive via postMessage handshake. | **PASS** |
| `PLAYER_INITIALIZATION_FAILED` | Target `<video>` located and started playback successfully. | **PASS** |
| `MEDIA_REQUEST_NOT_OBSERVED` | Media requests observed (`rn=1` through `rn=6`). | **PASS** |
| `MEDIA_REQUEST_FAILED` | In-flight requests aborted (`net::ERR_ABORTED`) during seek nudges. | **CONFIRMED** |
| `RESPONSE_BODY_CAPTURE_FAILED` | CDP `Network.getResponseBody` retrieved valid bytes for finished requests. | **PASS** |
| `INCOMPLETE_MEDIA_ACQUISITION` | Only ~2.62 MB out of estimated ~20 MB acquired before platform stall. | **CONFIRMED** |
| `UMP_PARSE_FAILED` | Parser handled valid frames without corrupting byte offsets. | **PASS** |
| `MEDIA_RECONSTRUCTION_FAILED` | Failed because complete stream ranges past 60s were never delivered. | **CONFIRMED** |
| `AUDIO_VIDEO_DURATION_MISMATCH` | Both tracks truncated at buffer boundary. | **CONFIRMED** |
| `FFMPEG_FAILED` | Not reached on full-length runs due to upstream acquisition stall. | **N/A** |
| `NATIVE_DOWNLOAD_FAILED` | Gated on valid output; correctly prevented corrupt file write. | **PASS** |
| `TIMEOUT` | Bounded fast-failure triggered after 15s of unyielding buffer stagnation. | **PASS** |

---

## 3. Root Cause Statement

The full-length browser acquisition failure on modern YouTube watch pages is caused by **upstream platform architectural constraints**:
1. YouTube delivers media exclusively via session-bound, encrypted SABR protobuf requests (`application/vnd.yt-ump`).
2. The client MSE buffer enforces a rolling forward horizon capped at 60.0 seconds.
3. Forcing buffer expansion via accelerated programmatic seeks results in immediate connection abortion (`net::ERR_ABORTED`).
4. Automated continuous playback triggers platform telemetry teardown at ~40 seconds in headless environments.
