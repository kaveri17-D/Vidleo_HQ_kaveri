# VIDLEO / NEXUS — RANGE-STREAMING VS. CDP/UMP ACQUISITION TECHNICAL COMPARISON

## Comparative Architecture Matrix

| Metric / Dimension | Historical Range-Streaming (`MediaEngine.execute`) | Current CDP/UMP Interception (`handleStartCdpDownload`) |
|---|---|---|
| **Mechanism** | HTTP `Range` requests directly to googlevideo CDN endpoints | Chrome DevTools Protocol (`Network.getResponseBody`) capturing active player UMP streams |
| **Max Practical Duration** | **Full video length** (Tested up to 635s / 10+ min and 40+ min) | **~48–60 seconds maximum** (Hard platform buffer cap) |
| **Platform Buffer Limit** | None; fetches byte ranges independent of DOM playback | 60.0s forward buffer limit enforced by YouTube DASH scheduler |
| **Sensitivity to Bot Detection** | Low (direct range slices against pre-signed format URLs) | Extremely high; synthetic drive loops (16x playback, repeated `seekTo`) trigger platform bot blocks |
| **WhatsApp Compatibility** | 100% (17/17 checks pass when normalized with AAC-LC) | 100% for short videos ($\le 60$s) |
| **Railway Media Transit** | **0 bytes** (`backend_media_bytes == 0`) | **0 bytes** (`backend_media_bytes == 0`) |
| **Failure Modes** | URL expiration or upstream cipher rotation | Stalled playback buffer, `net::ERR_ABORTED`, player teardown at ~36–48s |

## Key Recommendations
1. Route short videos ($\le 60$s) through CDP/UMP when user initiates in-tab capture.
2. Route long videos ($> 60$s) through `MediaEngine.execute` / Range-streaming to avoid player buffer stalls.
3. Preserve zero raw media transit through Railway across all routes.
