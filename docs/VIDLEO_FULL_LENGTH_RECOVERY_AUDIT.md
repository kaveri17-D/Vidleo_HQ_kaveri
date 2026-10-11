# VIDLEO / NEXUS — FULL-LENGTH RECOVERY AUDIT

**Date:** October 11, 2026  
**Repository:** `/home/system/Desktop/Vidleo_intergrated`  
**Git HEAD:** `db6c1e437e41b47803f8b513dee90fe3b0496bfe`  
**Branch:** `main` (`kaveri17-D/Vidleo_HQ_kaveri`)  

---

## 1. Environment & Architecture Inventory

### 1.1 Toolchain & Runtimes
- **Host System:** Linux x86_64 Ubuntu, Python 3.14.4, FFmpeg 8.0.1-3ubuntu2
- **Container Environment (`openshorts-main-renderer:latest`):** Node.js v18.20.8, npm 10.8.2, FFmpeg 5.1.9-0+deb12u1, Chromium 153.0.8010.52 (Debian bookworm)
- **Frontend Stack:** Next.js 14.2.15, React 18.3.1, TypeScript 5.6.3, `@ffmpeg/ffmpeg` 0.12.15, `mp4-muxer` 5.2.2, `webm-muxer` 5.1.4, `mp4box` 2.4.1
- **Extension Stack:** Chrome Manifest V3 (MV3), esbuild bundler, `@ffmpeg/core` WASM runner with in-memory MEMFS

### 1.2 Production Service Inventory
- **Frontend:** `https://frontend-kaveri-d.vercel.app/`
- **Control Plane API:** `https://backend-production-2ff30.up.railway.app`
- **Media Relay (Worker):** `https://nexus-media-relay.vidleo-relay.workers.dev/relay`
- **Accounting Endpoint:** `GET /api/accounting/media` (Strict invariant: `backend_media_bytes == 0`)

---

## 2. Real Download Runtime Call Chain

The complete path from user interaction to final local artifact:

```
[User Action: Video URL Submitted]
                 │
                 ▼
     UrlDownloader.tsx (handleAnalyze)
                 │
                 ▼
     DownloaderService.analyzeVideo()
         ├── POST /api/extract (Railway control plane / probe)
         └── Fallback: oEmbed metadata discovery
                 │
                 ▼
   VideoDetectedCard.tsx (Render & Format Selection)
                 │
                 ▼
[User Action: Click Download Button]
                 │
                 ▼
   VideoDetectedCard.tsx (handleTriggerDownload)
         │
         ├── [Case 1: YouTube & Extension Active]
         │        │
         │        ▼
         │   handleStartCdpDownload()
         │        │
         │        ▼
         │   extension/background/service-worker.ts (handleStartCdpMediaDownload)
         │        ├── chrome.debugger.attach (Network domain)
         │        ├── driveExpression: Accelerated active player playback
         │        ├── Intercept Network.responseReceived & loadingFinished
         │        ├── Network.getResponseBody (Base64 UMP / fMP4 chunks)
         │        ├── parseUmpMediaStreams() (Extract itag 133 / 395 video & audio)
         │        ├── offscreen / FFmpeg.wasm local remux (H.264/AVC + AAC-LC)
         │        └── chrome.downloads.download (Single native browser download)
         │
         └── [Case 2: Direct Progressive / HLS / Manifest Candidates]
                  │
                  ▼
             onDownload(selectedQuality, activeFormat, 'browser')
                  │
                  ▼
             UrlDownloader.tsx (handleDownloadTrigger)
                  │
                  ▼
             DownloaderService.executeDownload()
                  ├── 0A. browserAcquisitionEngine.acquire() [Direct Stream Fetch]
                  ├── 0B. MediaEngine.execute() [Adaptive Mux / FSA / OPFS]
                  └── 1.  POST /api/download-job [Governed Server Fallback]
```

---

## 3. Mandatory Architectural Constraints

1. **Zero Backend Media-Byte Transit:** Raw media bytes must NEVER transit through Railway server memory or disk (`backend_media_bytes == 0`).
2. **Honest Media Verification:** Success requires complete source duration matching, valid FFmpeg decode verification, and WhatsApp compatibility (H.264 Main, AAC-LC, faststart).
3. **No False Claims:** Partial buffer chunks or early stalls must never be reported as complete full-length downloads.
