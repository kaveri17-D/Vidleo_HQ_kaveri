# NEXUS Phase 4 — Extension & Cross-Platform Alignment Architecture Plan

**Document Version:** 1.0.0  
**Status:** **`ARCHITECTURE DESIGN & GATE REVIEW — NO CODE IMPLEMENTED`**  
**Author:** DeepMind Agentic Coding Pair  
**Baseline Reference:** [`docs/NEXUS_PHASE3_BASELINE.md`](file:///home/system/Desktop/Vidleo_intergrated/docs/NEXUS_PHASE3_BASELINE.md)  
**Governing Rule:** Protect existing Vidleo frontend as a working production baseline. Do not rewrite, duplicate, or alter existing functionality. Phase 4 features remain strictly disabled until explicit authorization.

---

## 1. Objective

Phase 4 defines the architecture to extend the proven, frozen NEXUS client-first media engine (`frontend/src/packages/media-engine/`) to browser extensions (Chrome Manifest V3, Firefox Manifest V2/V3) and future cross-platform client environments.

The primary architectural goal is **Single Engine, Multiple Shells**:
- The browser web application (`Vidleo_intergrated/frontend`) and the browser extension must share the exact same media demuxing, decrypting, timestamp normalization, and multiplexing intelligence.
- The extension must **NOT** become an independent or secondary downloader architecture.
- The extension must **NOT** duplicate HLS parsing, MPEG-TS demuxing, Web Crypto AES-128 decryption, or ticket validation logic.
- All existing web application paths, APIs, control plane contracts, and Phase 2 / Phase 3 edge infrastructure remain strictly preserved and backwards-compatible.

---

## 2. Current Architecture Review

The repository currently operates under the frozen NEXUS Client-First Media Download Architecture across three production-verified phases:

```
                                  [USER ACTION]
                                        |
                                        v
                            +-----------------------+
                            |   FASTAPI CONTROL     |
                            |   PLANE (Port 8000)   |
                            +-----------------------+
                                        |
       +--------------------------------+--------------------------------+
       |                                |                                |
       v                                v                                v
1. Manifest v1                  2. Strategy Engine              3. Signed Ticket Service
   - progressive[]                 - DIRECT_PROGRESSIVE            - HMAC-SHA256
   - video[]                       - DIRECT_RANGE                  - u_hash URL binding
   - audio[]                       - BROWSER_ADAPTIVE_MUX          - hst host binding
   - hls[]                         - BROWSER_HLS                   - typ resource binding
   - security & access             - SIGNED_WORKER_RANGE           - TTL: 120s - 300s
                                   - SERVER_FALLBACK               - Zero secret leak
                                        |
                                        v
               +-------------------------------------------------+
               |              BROWSER MEDIA ENGINE               |
               |      (frontend/src/packages/media-engine/)      |
               +-------------------------------------------------+
                 |                      |                      |
                 v                      v                      v
          [Direct CDN Fetch]   [Cloudflare Edge Relay]  [Server Runner]
          (CORS-friendly CDNs) (CORS-restricted CDNs)   (Fallback queue)
                 |                      |                      |
                 +----------------------+                      |
                                        |                      |
                                        v                      |
                         [HLS & Adaptive Demux/Remux]          |
                         - AES-128 Decrypt (crypto.subtle)     |
                         - MPEG-TS / ADTS Demux (Zero NPM)     |
                         - 90kHz Monotonic Timeline            |
                         - Fragmented mp4-muxer                |
                                        |                      |
                                        v                      |
                         [Storage Sink: FSA / OPFS]            |
                                        |                      v
                                        +---------------> [Final MP4]
```

---

## 3. Phase 3 Baseline Snapshot

At the completion of Phase 3, the system state is frozen and verified:
1. **Core Pipeline:** Fragmented MP4 multiplexing validated via `ffprobe` (`probe_score: 100`, duration 10.01s, H.264 Main 1280x720 60fps + AAC 44100Hz stereo) and `ffmpeg` (0 errors, 0 warnings, 0 frame drops).
2. **Cloudflare Edge Deployment:** `https://nexus-media-relay.vidleo-relay.workers.dev/relay` deployed with cryptographic resource-typed authorization (`typ`: `range` \| `playlist` \| `segment` \| `key`). 15/15 live edge security tests passing.
3. **Real Chromium 153 Headless Browser:** Live OPFS streaming write and read-back verified.
4. **Automated Unit & Failure Suites:** 28/28 unit tests passing; 30/30 failure matrix edge cases passing.
5. **Frontend Protection Gate:** Zero UI files modified. `downloaderService.ts` untouched. Next.js production build cleanly compiles all 34/34 pages statically.

---

## 4. Phase 4 Scope & Boundaries

### 4.1 In Scope
- Designing the shared package packaging model so `media-engine` can be consumed by both Next.js and browser extensions.
- Designing abstract interfaces for **Storage** (`MediaSink`) and **Network** (`MediaSourceFetcher`).
- Defining extension lifecycle constraints under Chrome Manifest V3 (ephemeral Service Workers, Offscreen Documents for media processing).
- Defining the extension-to-web messaging model and authentication boundary.
- Defining permissions minimization and security boundaries for extensions.
- Designing feature flags and rollback mechanisms for extension paths.

### 4.2 Explicitly Out of Scope
- Implementing extension code in this phase.
- Modifying existing Next.js pages or components (`frontend/src/app/**`, `frontend/src/components/**`).
- Altering the existing web downloader service (`frontend/src/services/downloader/downloaderService.ts`).
- Rewriting or refactoring Phase 2 Cloudflare Worker code.
- Adding new NPM runtime dependencies to the web frontend.
- Creating native desktop wrappers (Electron/Tauri) in this phase.

---

## 5. Shared MediaEngine Boundary

To avoid code duplication, the `frontend/src/packages/media-engine/` directory represents the **Shared Core Intelligence Layer**.

```
+-------------------------------------------------------------------------------+
|                       SHARED MEDIA ENGINE (TypeScript)                        |
|                                                                               |
|  +---------------------+   +---------------------+   +---------------------+  |
|  | Strategy Evaluator  |   | Capability Detector |   | Types & Schemas     |  |
|  | (strategy.ts)       |   | (capability.ts)     |   | (types.ts)          |  |
|  +---------------------+   +---------------------+   +---------------------+  |
|                                                                               |
|  +---------------------+   +---------------------+   +---------------------+  |
|  | Range Fetcher       |   | HLS Engine Suite    |   | Streaming Muxer     |  |
|  | (fetcher.ts)        |   | (hls/*)             |   | (muxer/mp4Muxer.ts) |  |
|  +---------------------+   +---------------------+   +---------------------+  |
+-------------------------------------------------------------------------------+
                           |                               |
                           v                               v
            +-----------------------------+ +-----------------------------+
            |      WEB CLIENT SHELL       | |   EXTENSION CLIENT SHELL    |
            |                             | |                             |
            | - UI / DownloaderService    | | - Content Script (DOM)      |
            | - File System Access Sink   | | - Offscreen Document (Mux)  |
            | - OPFS Sink                 | | - Service Worker (Download) |
            | - Web Fetch (CORS / Worker) | | - Extension Download Sink   |
            +-----------------------------+ +-----------------------------+
```

### 5.1 Shared Components (Zero Duplication)
1. **`hls/playlistParser.ts`**: Pure RFC 8216 playlist grammar.
2. **`hls/variant.ts`**: Multi-variant ranking and codec filtering.
3. **`hls/aesDecryptor.ts`**: Native W3C Web Crypto AES-128 decryption.
4. **`hls/tsDemuxer.ts`**: MPEG-TS & AAC ADTS demuxing, NAL extraction, `avcC` synthesis.
5. **`hls/timeline.ts`**: 90kHz timestamp normalization and discontinuity rebasing.
6. **`muxer/mp4Muxer.ts`**: MP4 box writing and track synchronization.
7. **`strategy.ts`**: Deterministic strategy resolution.

---

## 6. Web vs. Extension Responsibilities

| Dimension | Web Application Shell | Extension Client Shell (MV3) |
| :--- | :--- | :--- |
| **Execution Context** | Webpage window context / Worker | Offscreen Document (for WebCodecs/Wasm) + Background Service Worker |
| **Lifecycle** | Persistent while tab is open | Ephemeral (Service Worker terminates after 30s idle; Offscreen Document managed on demand) |
| **Network Capabilities** | Constrained by browser CORS; relies on Signed Worker Relay for private CDNs | Can request declarative host permissions or continue using Signed Worker Relay |
| **Storage Destination** | File System Access API dialog or Origin Private File System (`/`) | `chrome.downloads.download()` directly into default `Downloads/` directory |
| **Authentication** | Supabase session cookie / JWT | Scoped bearer token obtained via web-app message passing or `chrome.identity` |
| **DOM Access** | Full DOM access | Content Script has tab DOM access; Background SW and Offscreen doc do not have tab DOM |

---

## 7. Network Abstraction (`MediaSourceFetcher`)

The shared engine must decouple the *mechanism of fetching bytes* from the *media pipeline*.

### 7.1 Proposed Interface
```typescript
export interface FetchRequestOptions {
  url: string;
  headers?: Record<string, string>;
  range?: { start: number; end: number };
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface FetchResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface MediaSourceFetcher {
  fetch(options: FetchRequestOptions): Promise<FetchResponse>;
}
```

### 7.2 Implementations
1. **`WebDirectFetcher`**: Standard `window.fetch()` with Range headers.
2. **`WorkerRelayFetcher`**: Routes requests through `https://nexus-media-relay.vidleo-relay.workers.dev/relay` with signed tickets.
3. **`ExtensionDirectFetcher`**: Uses extension host permissions for direct CDN streams where web CORS is blocked, eliminating edge relay cost when running inside the extension shell.

---

## 8. Storage Abstraction (`MediaSink`)

The existing `MediaSink` interface in [`frontend/src/packages/media-engine/sink/sink.ts`](file:///home/system/Desktop/Vidleo_intergrated/frontend/src/packages/media-engine/sink/sink.ts) is already cleanly abstracted:
```typescript
export interface MediaSink {
  open(filename: string, expectedSize?: number, mimeType?: string): Promise<void>;
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
```

### 8.1 Existing Sinks
- **`FileSystemAccessSink`**: Streams directly to user-selected file on disk via `FileSystemWritableFileStream`.
- **`OPFSSink`**: Streams directly to Origin Private File System (`navigator.storage.getDirectory()`).
- **`BlobSink`**: In-memory chunk buffer for environments lacking OPFS/FSA.

### 8.2 Proposed Extension Sink (`ExtensionDownloadSink`)
In Chrome MV3, `chrome.downloads.download()` requires a `url` parameter (either an HTTP URL, `data:`, or `blob:`).
- `ExtensionDownloadSink` will stream chunks into a temporary OPFS file in the Offscreen Document context.
- Upon `close()`, it creates a `blob:` URL referencing the completed file, transmits it to the Background Service Worker via `chrome.runtime.sendMessage()`, and invokes `chrome.downloads.download({ url: blobUrl, filename, saveAs: false })`.
- Upon download completion or failure, the temporary OPFS file and blob URL are revoked, maintaining zero disk leak.

---

## 9. Authentication & Trust Boundary

### 9.1 Absolute Invariants
- **NEVER** expose `SIGNED_DOWNLOAD_SECRET` to the extension.
- **NEVER** expose Supabase service-role keys or database credentials to the extension.
- **NEVER** store permanent admin credentials in extension local storage.

### 9.2 Extension Authentication Flow
```
[User logs in on vidleo.app]
            |
            v
[Vidleo Web App sets authenticated session]
            |
[Extension Content Script queries Web App via window.postMessage with nonce]
            |
[Web App verifies origin: chrome-extension://<EXTENSION_ID>]
            |
[Web App returns short-lived User Bearer Token (TTL: 1 hour)]
            |
[Extension Background SW stores token in chrome.storage.session (memory only)]
            |
[Extension signs API requests to FastAPI Control Plane: Authorization: Bearer <TOKEN>]
```

---

## 10. Security Architecture & Threat Model

### 10.1 Extension Permission Minimization
The extension `manifest.json` must adhere to least-privilege principles:
- **`permissions`**:
  - `downloads`: To save completed media files to disk.
  - `storage`: Scoped session storage (`chrome.storage.session`) for ephemeral credentials.
  - `offscreen`: To execute WebCodecs and MP4 multiplexing without blocking UI.
- **`host_permissions`**:
  - Strictly limited to `https://*.vidleo.app/*` and `http://127.0.0.1:8000/*` (control plane) and `https://nexus-media-relay.vidleo-relay.workers.dev/*` (edge relay).
  - Wildcard `<all_urls>` is **FORBIDDEN**.

### 10.2 Component Boundaries & Defense in Depth
1. **Content Script (Untrusted DOM Context):**
   - Cannot make direct privileged API calls.
   - Cannot issue download tickets.
   - Only detects page video URLs and forwards them to the Background Service Worker.
2. **Background Service Worker (Privileged Extension Context):**
   - Validates URLs against SSRF patterns before communicating with backend.
   - Communicates with FastAPI control plane to resolve manifests and acquire tickets.
   - Never parses raw media chunks directly (delegates to Offscreen Document).
3. **Offscreen Document (Isolated Processing Sandbox):**
   - Executes `MediaEngine` pipeline (HLS parsing, AES decryption, demuxing, muxing).
   - Has no network access except through standard `fetch()`.
   - Communicates with Service Worker via structured message passing (`onProgress`, `onComplete`, `onError`).

---

## 11. API Model & Compatibility

Zero replacement APIs are introduced. The extension shell communicates with the **exact same FastAPI Control Plane** endpoints as the Web App:

| Endpoint | Method | Responsibility | Extension Compatibility |
| :--- | :---: | :--- | :--- |
| `/api/resolve` | POST | Extractor probe & manifest generation | Reused identically. |
| `/api/downloads/{id}/manifest` | GET | Versioned MediaManifest v1 retrieval | Reused identically. |
| `/api/downloads/{id}/strategy` | POST | Deterministic strategy evaluation | Reused identically. |
| `/api/downloads/{id}/ticket` | POST | Short-lived signed ticket acquisition | Reused identically. |
| `/api/downloads/{id}/complete` | POST | Download history & quota synchronization | Reused identically (`delivery_mode: "extension_download"`). |
| `/api/downloads/{id}/cancel` | POST | Job cancellation handler | Reused identically. |

---

## 12. Extension Messaging Model (Manifest V3)

```
[Content Script]  ---> (EXT_DETECT_MEDIA)  ---> [Background Service Worker]
                                                         |
                                                POST /api/resolve
                                                         |
                                                Spawns Offscreen Document
                                                         |
[Background SW]   ---> (START_DOWNLOAD)   ---> [Offscreen Document]
                                                         |
                                                HLSEngine.execute()
                                                MPEG-TS Demux / Mux
                                                         |
[Offscreen Doc]   ---> (DOWNLOAD_PROGRESS)---> [Background SW / Popup UI]
                                                         |
                                                Upon Completion:
[Offscreen Doc]   ---> (DOWNLOAD_COMPLETE)---> [Background SW]
                                                         |
                                                chrome.downloads.download()
                                                POST /api/downloads/{id}/complete
```

---

## 13. Cross-Platform Compatibility Matrix

| Platform / Client | Shared MediaEngine | OPFS Sink | FSA Sink | Native Download Sink | Direct CDN Fetch | Signed Worker Relay | HLS Support | Server Fallback |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Web Chrome / Edge** | `FULL` | `YES` | `YES` | N/A | `YES` (CORS-permitting) | `YES` | `YES` | `YES` |
| **Web Firefox** | `FULL` | `YES` | `NO` | N/A | `YES` (CORS-permitting) | `YES` | `YES` | `YES` |
| **Web Safari** | `FULL` | `YES` | `NO` | N/A | `YES` (CORS-permitting) | `YES` | `YES` | `YES` |
| **Extension Chromium (MV3)** | `FULL` | `YES` (Offscreen) | `NO` | `YES` (`chrome.downloads`) | `YES` | `YES` | `YES` | `YES` |
| **Extension Firefox (MV2/MV3)**| `FULL` | `YES` | `NO` | `YES` (`browser.downloads`) | `YES` | `YES` | `YES` | `YES` |
| **Future Desktop Client** | `FULL` | `YES` | `YES` | `YES` (Native FS) | `YES` | `YES` | `YES` | `YES` |

---

## 14. Performance & Resource Constraints

1. **Memory Ceiling:**
   - Background Service Worker memory: < 15 MB.
   - Offscreen Document processing memory: strictly bounded to 2 concurrent segments in flight (< 40 MB V8 Heap).
   - Zero full-file ArrayBuffers in memory.
2. **CPU & Background Throttling:**
   - MV3 Offscreen Documents are subject to browser background throttling if minimized. Chunk timeouts must tolerate low-priority execution states.
3. **Concurrency Bounds:**
   - Max 2 concurrent segments per job (`MAX_HLS_CONCURRENT_SEGMENTS = 2`).
   - Max 1 concurrent muxing pipeline per browser tab/extension session.

---

## 15. Observability & Telemetry

Every download execution (whether from Web or Extension) reports structured telemetry via `POST /api/downloads/{id}/complete` or control plane logs:
- `job_id`: Unique identifier.
- `client_type`: `web` \| `extension_chrome` \| `extension_firefox`.
- `client_version`: Extension version string (e.g. `1.0.0`).
- `strategy`: `BROWSER_HLS` \| `SIGNED_WORKER_RANGE` \| `DIRECT_PROGRESSIVE` \| `SERVER_FALLBACK`.
- `delivery_mode`: `browser_hls` \| `signed_worker_remux` \| `extension_download` \| `direct_fsa`.
- `bytes_downloaded`: Exact integer byte count.
- `duration_ms`: Total execution time.
- **Redaction Rule:** Zero cookies, auth tokens, ticket HMACs, or user secrets logged.

---

## 16. Failure & Fallback Taxonomy

Every failure condition must map to a deterministic outcome:

| Failure Scenario | Engine Code | Shell Behavior | Recovery / Outcome |
| :--- | :--- | :--- | :--- |
| **Unsupported Codec (e.g. HEVC/AV1 in TS)** | `CODEC_UNSUPPORTED` | Automatic Fallback | Routes to `SERVER_FALLBACK` (FFmpeg transcode). |
| **DRM / SAMPLE-AES Encountered** | `DRM_ENCOUNTERED` | Automatic Fallback | Routes to `SERVER_FALLBACK` or `UNSUPPORTED`. |
| **Worker Relay Timeout / 5xx** | `RELAY_FAILED` | Automatic Fallback | Retries 3x, then falls back to `SERVER_FALLBACK`. |
| **Offscreen Document Terminated** | `CONTEXT_DESTROYED` | Controlled Recovery | Service Worker restarts Offscreen doc from last checkpoint. |
| **User Aborts Download** | `CANCELLED` | Clean Teardown | Closes sink, revokes temporary OPFS files, calls `/api/downloads/{id}/cancel`. |
| **Corrupt TS Sync Byte (`!0x47`)** | `INVALID_SEGMENT` | Safe Rejection | Aborts job without writing partial corrupt container. |

---

## 17. Proposed Feature Flags (Disabled by Default)

The following flags will guard all Phase 4 code. None are activated:

```bash
# Backend Environment (backend/.env)
NEXUS_EXTENSION_ENABLED=false
NEXUS_EXTENSION_DOWNLOAD_ENABLED=false

# Frontend Environment (frontend/.env.local)
NEXT_PUBLIC_NEXUS_EXTENSION_ENABLED=false
```

---

## 18. Component Reuse Classification

| Component | Classification | Rationale |
| :--- | :---: | :--- |
| `frontend/src/packages/media-engine/hls/*` | **`REUSE (100%)`** | Complete reuse of pure TS HLS parser, decryptor, demuxer, timeline. |
| `frontend/src/packages/media-engine/muxer/*` | **`REUSE (100%)`** | Complete reuse of streaming fragmented MP4 muxer. |
| `frontend/src/packages/media-engine/strategy.ts`| **`REUSE (100%)`** | Complete reuse of deterministic client strategy evaluator. |
| `frontend/src/packages/media-engine/sink/sink.ts`| **`EXTEND`** | Add `ExtensionDownloadSink` implementing existing `MediaSink` interface. |
| `frontend/src/services/downloader/*` | **`ISOLATE`** | Web downloader remains isolated. Extension uses its own shell caller. |
| `worker/src/*` | **`KEEP (FROZEN)`** | Cloudflare Worker edge remains completely untouched. |
| `backend/main.py` | **`KEEP (FROZEN)`** | Existing control plane endpoints handle extension requests transparently. |

---

## 19. Files Expected to Change (During Future Phase 4)

When Phase 4 implementation is authorized:
1. `packages/media-engine/sink/extensionSink.ts` (NEW): Extension-specific `MediaSink`.
2. `extension/` (NEW DIRECTORY):
   - `manifest.json`: Extension Manifest V3 configuration.
   - `src/background/serviceWorker.ts`: Extension lifecycle and control plane client.
   - `src/offscreen/offscreen.ts`: Isolated media processing runner hosting `MediaEngine`.
   - `src/content/contentScript.ts`: Page media URL sniffer.
   - `src/popup/`: Extension popup UI for download triggers.

---

## 20. Files Explicitly Protected (DO NOT TOUCH)

The following directories and files are **FROZEN & PROTECTED**:
- `frontend/src/app/**`: All Next.js pages and layouts.
- `frontend/src/components/**`: All UI components, buttons, and styles.
- `frontend/src/services/downloader/downloaderService.ts`: Existing web downloader service.
- `backend/main.py`: Existing FastAPI routes.
- `backend/ticket_service.py`: Existing HMAC signing contracts.
- `worker/src/**`: Production Cloudflare Worker relay.

---

## 21. Testing Strategy

1. **Unit Tests:** Run existing 28 unit tests and 30 failure matrix tests against `MediaEngine` in Node and Offscreen environments.
2. **End-to-End Extension Test:** Headless Chromium loading unpacked extension via `--load-extension`, verifying:
   - Media detection in content script.
   - Message dispatch to Background Service Worker.
   - Offscreen Document execution of `MediaEngine`.
   - Final file delivery via `chrome.downloads`.
3. **Regression Test:** Full regression test on web application with `NEXUS_EXTENSION_ENABLED=false` to prove zero web regression.

---

## 22. Rollback Strategy

If any extension defect is detected in production:
1. Set `NEXUS_EXTENSION_ENABLED=false` in `backend/.env`.
2. Control plane will reject extension-originated strategy requests with `403 FEATURE_DISABLED`.
3. Web application continues running with 0% impact.

---

## 23. Identified Risks & Mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| **MV3 Service Worker Inactivity Termination** | High | Delegate long-running media demux/mux to an active Offscreen Document which keeps its own message port alive until completion. |
| **Memory Pressure in Extension Context** | Medium | Maintain Phase 3 bounded concurrency (max 2 segments in flight) and stream-to-disk OPFS temporary sinks. |
| **CORS Discrepancies between Web and Ext** | Low | Extension can utilize host permissions or transparently fall back to the existing Cloudflare edge relay. |

---

## 24. Implementation Order (For Future Authorization)

1. **Step 1:** Create `ExtensionDownloadSink` implementing `MediaSink` in `frontend/src/packages/media-engine/sink/`.
2. **Step 2:** Scaffold `extension/` directory with Manifest V3 and build pipeline.
3. **Step 3:** Implement Offscreen Document runner importing shared `MediaEngine`.
4. **Step 4:** Implement Background Service Worker control plane dispatcher.
5. **Step 5:** Validate against real YouTube / HLS sources using headless Chromium.
6. **Step 6:** Run full web regression suite (`npm run build`, Phase 1, Phase 2, Phase 3).

---

## 25. Definition of Done

Phase 4 will only be considered complete when:
- Extension successfully downloads HLS and progressive streams using the **shared MediaEngine**.
- Downloaded MP4 passes `ffprobe` score 100 and FFmpeg 0 errors.
- Existing Next.js frontend has zero modified UI or downloader files.
- Full regression suite passes with all Phase 4 flags disabled.
