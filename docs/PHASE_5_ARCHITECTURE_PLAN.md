# NEXUS Phase 5 — Server Fallback & Production Integration Architecture Plan

**Document Version:** 1.0.0  
**Status:** **`ARCHITECTURE GATE — READY FOR REVIEW`**  
**Governing Rule:** Architecture & Readiness Gate Only. Zero Code Implementation Prior to Approval.  
**Protected Baselines:** `frontend/src/app/**`, `frontend/src/components/**`, `downloaderService.ts`, `worker/**`, `extension/**`.

---

## 1. Current Fallback Architecture

### 1.1 Existing Component Map

```
                      +---------------------------------------+
                      |   Client (Browser / MV3 Extension)    |
                      +---------------------------------------+
                                          |
                                          | POST /api/download-job
                                          v
                      +---------------------------------------+
                      |  CreditGateMiddleware (FastAPI)       |
                      |  - Reserves 1 credit in Redis hot     |
                      |    ledger via Lua (check_and_reserve) |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |  POST /api/download-job (main.py)     |
                      |  - URL validation & rate limit check  |
                      |  - Format resolution via yt-dlp probe |
                      |  - Redis dedupe check (claim_or_find) |
                      |  - Registers job in memory & Redis    |
                      |  - Schedules sync to Supabase (jobs)  |
                      +---------------------------------------+
                                          |
                      +-------------------+-------------------+
                      | (NEXUS_USE_CELERY=1)                  | (NEXUS_USE_CELERY=0)
                      v                                       v
         +--------------------------+           +--------------------------+
         | Celery Task Dispatcher   |           | Local Async Task Runner  |
         | download_delivery_task   |           | run_download_job_async   |
         | Queue: "render"          |           | (in-process asyncio)     |
         +--------------------------+           +--------------------------+
                      |                                       |
                      +-------------------+-------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |  job_runner.py & download_handler.py  |
                      |  - yt-dlp + FFmpeg subprocess         |
                      |  - Cookie vault / Proxy handling      |
                      |  - Stream to backend/.runtime/        |
                      |  - Progress parsing -> Redis state    |
                      +---------------------------------------+
                                          |
                      +-------------------+-------------------+
                      | Web Delivery                          | Telegram/Discord Delivery
                      v                                       v
         +--------------------------+           +--------------------------+
         | Local File Delivery      |           | storage_handler.py       |
         | /api/download/file/{id}  |           | - Upload to R2 (if cfg)  |
         | BackgroundTask cleanup   |           | - Or signed fallback tok |
         +--------------------------+           +--------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |  Job Completion & Ledger Commit       |
                      |  - commit_credits() -> Supabase       |
                      |  - media_history row inserted         |
                      +---------------------------------------+
```

### 1.2 Audited Source Files & Existing Mechanisms

1. **`backend/main.py` (`start_download`, lines 1414–1524):**
   - Intercepted by `CreditGateMiddleware`: allocates `job_id`, checks sliding-window rate limit (100 ops/min), and reserves credit in Redis.
   - Validates URL via `_validate_media_url()` (regex checks for private IPs, blocked schemes).
   - Re-extracts media info via `extract_media_info(lightweight_probe=True)` to confirm format availability.
   - Enforces Telegram (`MAX_TELEGRAM_BYTES = 50MB`) and Discord (`MAX_DISCORD_BYTES = 25MB`) delivery constraints.
   - Evaluates active download deduplication via `claim_or_find_active_download()`.
   - Dispatches either via `download_delivery_task.delay()` (Celery `render` queue) or `asyncio.create_task(run_download_job_async())`.

2. **`backend/job_store.py`:**
   - In-memory dictionaries: `JOB_RUNTIME_STATE`, `JOB_RUNTIME_EVENTS`, guarded by `JOB_LOCK = asyncio.Lock()`.
   - Redis sync: stores state at `nexus:job:state:{job_id}`, events list at `nexus:job:events:{job_id}`, index at `nexus:job:index`.
   - Supabase sync: `_sync_job_row()` and `_sync_job_event()` write to tables `public.jobs` and `public.job_events` via `asyncio.to_thread`.
   - Concurrency deduplication: `claim_or_find_active_download()` uses `SET nexus:job:dedupe:{digest} job_id NX EX 600`.

3. **`backend/job_runner.py`:**
   - Pre-run cancellation check: `_ensure_not_cancelled(job_id)`.
   - Workspace creation: `create_temp_output(title)` in `backend/.runtime/downloads/nexus_media_<id>/`.
   - Execution: delegates to `download_selected_media()` in `backend/download_handler.py`.
   - On completion: commits credits via `commit_credits()`, updates status to `completed`, sets `download_url = /download/file/{job_id}`.
   - On failure/cancellation: refunds credits via `refund_credits()`, calls `_cleanup_temp(temp_dir)`.

4. **`backend/download_handler.py`:**
   - Direct execution of `yt-dlp` with `--ffmpeg-location` via `subprocess.Popen`.
   - YouTube strategy ladder: Cookie Vault &rarr; Residential Proxy &rarr; Direct VPS.
   - Other providers: Direct VPS connection with opportunistic cookies.
   - Progress parser: `DownloadProgressTracker` parsing stdout/stderr regexes and invoking progress callback.

5. **`backend/storage_handler.py`:**
   - Delivery artifact generator: `create_delivery_artifact()`.
   - Cloudflare R2 integration via `boto3` client (if `R2_BUCKET` is configured), generating presigned `get_object` URLs.
   - Local fallback registry: stores metadata in Redis key `fallback_artifact:{token}` with HMAC-SHA256 signature token.
   - Periodic cleanup: `cleanup_expired_local_artifacts()` scans expired tokens and deletes underlying temp directories.

6. **`backend/celery_app.py` & `backend/tasks.py`:**
   - Celery broker and backend on Redis.
   - Queue sharding: `meta` (probe/validation), `render` (downloads/FFmpeg), `syndicate` (uploads/webhooks), `maintenance_worker` (rollups/cleanup).
   - Celery hardening parameters: `worker_prefetch_multiplier=1`, `task_acks_late=True`, `worker_concurrency=4`, `worker_max_tasks_per_child=50`, `worker_max_memory_per_child_kb=512000`, `task_time_limit=1800`.

---

## 2. Fallback Decision Policy

### 2.1 Deterministic Precedence Ladder
NEXUS strictly prioritizes client-side and edge delivery before ever touching server resources:

```
1. DIRECT_PROGRESSIVE   (Direct CDN delivery; zero server or worker cost)
        |
2. DIRECT_RANGE         (Progressive stream with HTTP Range slicing)
        |
3. BROWSER_ADAPTIVE_MUX (Browser client demuxes & remuxes separate audio/video)
        |
4. BROWSER_HLS          (Browser HLS engine: AES-128 decrypt, TS demux, MP4 mux)
        |
5. SIGNED_WORKER_RANGE  (Cloudflare Edge Worker relays CORS-restricted streams)
        |
6. EXTENSION_PATH       (Manifest V3 Background SW + Offscreen Document)
        |
7. SERVER_FALLBACK      (Controlled Celery/FFmpeg server execution)
        |
8. UNSUPPORTED          (Explicitly rejected with client error code)
```

### 2.2 Explicit Fallback Reason Taxonomy
Every fallback transition to `SERVER_FALLBACK` must be tagged with an immutable `fallback_reason` code:

| Reason Code | Trigger Condition | Preceding Attempt |
| :--- | :--- | :--- |
| `WORKER_UNAVAILABLE` | `DISABLE_WORKER_RELAY=true` circuit-breaker tripped | `SIGNED_WORKER_RANGE` |
| `HLS_FLAG_DISABLED` | `NEXUS_BROWSER_HLS_ENABLED=false` | `BROWSER_HLS` |
| `HLS_CLIENT_CAPABILITY_MISSING` | Browser client lacks WebCodecs / MediaSource / OPFS | `BROWSER_HLS` |
| `HLS_UNSUPPORTED_ENCRYPTION` | HLS stream encrypted with SAMPLE-AES or FairPlay/DRM | `BROWSER_HLS` |
| `HLS_UNSUPPORTED_CODEC` | HLS stream contains non-H.264 video (e.g. HEVC/AV1) | `BROWSER_HLS` |
| `CLIENT_REMUX_UNSUPPORTED` | Browser lacks File System Access & OPFS for adaptive mux | `BROWSER_ADAPTIVE_MUX` |
| `SOURCE_REQUIRES_SERVER` | Stream requires cookie vault impersonation / PO token | `DIRECT_PROGRESSIVE` |
| `CLIENT_EXECUTION_FAILED` | Client-first download threw runtime network/demux error | Client MediaEngine |
| `EXPLICIT_TRANSCODE_REQUEST` | Caller requested audio extraction or format transcode | Direct Stream |

---

## 3. Job State Machine

### 3.1 Formal State Enumeration
The state machine reuses existing states in `public.jobs` and introduces explicit lifecycle sub-stages:

```
[CREATED] ------------> [FAILED] (Initial validation error)
    |
    v
[QUEUED] -------------> [CANCEL_REQUESTED] ----> [CANCELLED]
    |                          ^
    v                          |
[EXTRACTING] ------------------+
    |                          |
    v                          |
[DOWNLOADING] -----------------+
    |                          |
    v                          |
[PROCESSING] ------------------+
    |
    v
[UPLOADING]
    |
    v
[COMPLETED] (Terminal Success)
    |
    v (TTL Expiry)
[EXPIRED] (Artifact Purged)
```

### 3.2 State Transition Rules

| From State | Allowed To States | Actor / Trigger | Forbidden Transitions |
| :--- | :--- | :--- | :--- |
| `CREATED` | `QUEUED`, `FAILED`, `CANCELLED` | API Handler (`main.py`) | `DOWNLOADING`, `PROCESSING`, `COMPLETED` |
| `QUEUED` | `EXTRACTING`, `DOWNLOADING`, `CANCEL_REQUESTED`, `FAILED` | Celery / Runner worker | `COMPLETED`, `UPLOADING` |
| `EXTRACTING` | `DOWNLOADING`, `CANCEL_REQUESTED`, `FAILED` | `job_runner.py` / probe | `COMPLETED`, `UPLOADING` |
| `DOWNLOADING` | `PROCESSING`, `UPLOADING`, `COMPLETED`, `CANCEL_REQUESTED`, `FAILED` | `download_handler.py` | `CREATED`, `QUEUED` |
| `PROCESSING` | `UPLOADING`, `COMPLETED`, `CANCEL_REQUESTED`, `FAILED` | FFmpeg remux / transcode | `CREATED`, `QUEUED`, `DOWNLOADING` |
| `UPLOADING` | `COMPLETED`, `FAILED` | `storage_handler.py` (R2) | `DOWNLOADING`, `PROCESSING` |
| `CANCEL_REQUESTED` | `CANCELLED`, `FAILED` | Process killer watchdog | `COMPLETED`, `UPLOADING`, `DOWNLOADING` |
| `COMPLETED` | `EXPIRED` | Retention cleaner | Any active state |
| `FAILED` | *None (Terminal)* | Terminal error handler | Any other state |
| `CANCELLED` | *None (Terminal)* | Terminal cancel handler | Any other state |
| `EXPIRED` | *None (Terminal)* | Artifact cleanup task | Any other state |

---

## 4. Idempotency & Concurrency Deduplication

### 4.1 Vulnerability in Current Code
Currently, deduplication relies entirely on Redis `claim_or_find_active_download()` (`SET NX EX 600`).
If Redis restarts or is unavailable:
1. Two rapid identical requests both pass the check.
2. Two expensive yt-dlp/FFmpeg processes spawn simultaneously on the server.
3. Both processes write to the same disk path or burn double VPS/Proxy bandwidth.
4. User may be charged twice.

### 4.2 Phase 5 Two-Tier Architecture
1. **Tier 1 (Fast Path — Redis):**
   - Atomic key: `nexus:job:dedupe:{sha256(user_id|normalized_url|format_id)}`.
   - TTL: 600s.
   - If key exists and references an active job (`QUEUED`, `EXTRACTING`, `DOWNLOADING`, `PROCESSING`), return the existing `job_id` and refund the middleware credit.
2. **Tier 2 (Authoritative Source of Truth — PostgreSQL):**
   - Introduce a partial unique index on `public.jobs`:
     ```sql
     CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_dedupe 
     ON public.jobs (user_id, normalized_url, requested_format_id) 
     WHERE status IN ('created', 'queued', 'extracting', 'downloading', 'processing');
     ```
   - If Redis fails, the database constraint `UNIQUE_VIOLATION` (Postgres error 23505) atomically catches the race, queries the existing active job, and returns it. Zero duplicate subprocesses can execute.

---

## 5. Quota & Billing Safety

### 5.1 Authoritative Principle
**CLIENT COMPLETION IS NEVER AUTHORITATIVE FOR BILLING.**  
Only verified server-side execution termination or signed worker edge telemetry can authorize credit commits.

### 5.2 Two-Phase Quota Lifecycle
```
Request Received
       |
       v
1. [RESERVED]  ---> Lua FCALL check_and_reserve (Redis hot balance decremented)
       |
       +---> Handler Failure / 4xx/5xx ---> [REFUNDED] (Redis balance restored)
       |
       +---> Job Cancelled / Aborted   ---> [REFUNDED] (Redis balance restored)
       |
       v
2. [COMMITTED] ---> Job Completes Successfully
                    Atomic SQL: UPDATE profiles SET clip_credits = clip_credits - 1 ...
                    Release Redis reservation key
```

### 5.3 Hardening Against Stranded Reservations
- **Identified Gap:** If a Celery worker dies of `SIGKILL` mid-download, the credit remains stuck in `tenant:{user_id}:reserved` forever.
- **Phase 5 Mitigation:**
  - Introduce a durable timestamp inside the reservation hash: `HSET tenant:{user_id}:reserved {job_id} {cost}:{timestamp}`.
  - Implement a dedicated reconciliation sweep in `billing_reconciliation_task`:
    - Scans reservations older than 30 minutes.
    - Checks database status for the corresponding `job_id`.
    - If job is `FAILED`, `CANCELLED`, or missing: automatically releases the reservation and refunds the user's available balance in Redis.

---

## 6. Queue Reliability & 7. Transactional Outbox

### 6.1 The Distributed Double-Write Problem
In the current code (`main.py` lines 1480–1506):
1. `register_job()` writes to memory/Redis and asynchronously dispatches a thread to write to Supabase.
2. `download_delivery_task.delay()` publishes the message to Celery Redis broker.
- **Failure Mode A:** Celery enqueue succeeds, but DB write fails. A worker executes a job that has no durable row in PostgreSQL.
- **Failure Mode B:** DB write succeeds, but Celery enqueue fails. The job hangs in `QUEUED` indefinitely.

### 6.2 Transactional Outbox Design
To ensure 100% consistency between PostgreSQL and Celery:
1. **Schema Extension (`public.jobs`):**
   ```sql
   ALTER TABLE public.jobs 
     ADD COLUMN IF NOT EXISTS outbox_status text NOT NULL DEFAULT 'pending',
     ADD COLUMN IF NOT EXISTS outbox_dispatched_at timestamptz;
   CREATE INDEX IF NOT EXISTS idx_jobs_outbox_pending ON public.jobs(outbox_status) WHERE outbox_status = 'pending';
   ```
2. **Atomic Ingestion:**
   - In `POST /api/download-job`, the job is committed to PostgreSQL with `status = 'queued'` and `outbox_status = 'pending'` within a database transaction.
   - Immediately after DB commit, publish to Celery: `task = download_delivery_task.delay(job_id, payload, user)`.
   - Update `outbox_status = 'dispatched'`, `celery_task_id = task.id`.
3. **Outbox Sweeper (Safety Net):**
   - Scheduled task running every 60s scans `outbox_status = 'pending'` older than 30s.
   - Re-publishes lost messages to Celery and marks them `dispatched`.
   - Celery `task_acks_late=True` prevents task loss if the worker crashes before acknowledging.

---

## 8. Extraction Safety & 9. FFmpeg Safety

### 8.1 yt-dlp Process Hardening
- **No Raw Shell Strings:** Always pass arguments as `list[str]` to `subprocess.Popen(args, shell=False)`.
- **Pre-Execution SSRF Validation:** Every input URL must pass `validate_outbound_url()` from `backend/outbound_policy.py` before being passed to `yt-dlp`.
- **Egress Binding:** Enforce `--abort-on-error`, `--no-playlist`, `--max-downloads 1`.
- **Credential Hygiene:** Cookie vault temporary files created with `0600` permissions in secure RAM-backed or isolated directories and wiped in `try...finally`.

### 8.2 FFmpeg Subprocess Constraints
FFmpeg execution must be strictly bounded to prevent CPU/memory exhaustion attacks:

| Parameter | Safety Limit | Implementation Mechanism |
| :--- | :--- | :--- |
| **Max Runtime** | 300 seconds (5 min) | `subprocess.wait(timeout=300)` |
| **Max Output Size**| 5.0 GB | yt-dlp `--max-filesize 5G` + disk quota monitor |
| **Memory Limit** | 512 MB per worker | `RLIMIT_AS` via `preexec_fn` or Celery memory cap |
| **CPU Limit** | 2 threads per FFmpeg job | `-threads 2` in FFmpeg args |
| **Concurrency** | Max 4 concurrent renders | Celery `worker_concurrency=4` on `render` queue |
| **Max Video Res** | 4K (3840x2160) | Gated by user plan entitlements |
| **Max Duration** | 2 hours (7200s) | Checked during initial probe |

---

## 10. Resource Limits & 18. Concurrency / Backpressure

### 10.1 Multi-Tenant Capacity Protection
To prevent a single user or bot from monopolizing worker capacity:
1. **Global Concurrency:** Maximum 4 concurrent active FFmpeg renders (enforced by Celery worker pool size).
2. **Per-User Concurrency:** Maximum 2 concurrent active server downloads per user.
   - Evaluated via `SELECT COUNT(*) FROM public.jobs WHERE user_id = $1 AND status IN ('queued', 'downloading', 'processing')`.
   - If count >= 2, HTTP 429 (`TOO_MANY_CONCURRENT_JOBS`) is returned.
3. **Queue Sharding:**
   - Free users: routed to `render_free` (concurrency 1).
   - Pro/Owner users: routed to `render_priority` (concurrency 3).

---

## 11. Cancellation & Process Teardown

### 11.1 Active Subprocess Tracking
Currently, `download_handler.py` runs `process.wait()` on a thread with no active reference stored in the job store.
**Phase 5 Implementation:**
1. Maintain active process registry: `ACTIVE_PROCESSES: dict[str, subprocess.Popen] = {}`.
2. When `POST /api/downloads/{job_id}/cancel` is invoked:
   - Sets `status = 'cancelled'`, `cancel_requested = true` in PostgreSQL and Redis.
   - Revokes Celery task: `celery_app.control.revoke(celery_task_id, terminate=True, signal="SIGTERM")`.
   - Locates `process = ACTIVE_PROCESSES.get(job_id)`.
   - Sends `SIGTERM` to subprocess and process group.
   - Waits 3 seconds; if still alive, sends `SIGKILL`.
   - Immediately deletes `temp_dir` via `_cleanup_temp()`.
   - Refunds reserved credits.

---

## 12. Retry Policy

### 12.1 Categorization Table

| Error Class | Category | Retryable? | Max Retries | Backoff Strategy |
| :--- | :--- | :---: | :---: | :--- |
| `HTTP 404 / 410` | Source Invalid / Deleted | **NO** | 0 | Fail fast; report `SOURCE_NOT_FOUND` |
| `HTTP 403 / Bot Wall` | Cookie / IP blocked | **NO (same path)** | 1 (alt) | Switch from cookie to proxy; max 1 attempt |
| `UNSUPPORTED_CODEC` | Format unrenderable | **NO** | 0 | Fail fast; report `CODEC_UNSUPPORTED` |
| `SSRF_VIOLATION` | Security blocked | **NO** | 0 | Fail fast; security incident logged |
| `HTTP 502 / 503 / 504` | Upstream CDN transient | **YES** | 2 | Exponential ($5s, 15s$) + jitter |
| `NETWORK_TIMEOUT` | Socket hung / reset | **YES** | 2 | Exponential ($5s, 15s$) + jitter |
| `R2_UPLOAD_ERROR` | Storage API failure | **YES** | 3 | Exponential ($2s, 6s, 18s$) |

---

## 13. Timeout Policy

Strict hierarchically nested timeouts ensure zero hung requests:

```
[Entire Job Lifecycle Ceiling: 1800s (30m)]
   |
   +---> Extraction Probe: 15s
   |
   +---> Outbox Queue Dispatch: 30s
   |
   +---> Media Download (yt-dlp): 900s (15m)
   |
   +---> FFmpeg Processing: 300s (5m)
   |
   +---> Storage Upload (R2): 120s (2m)
```

---

## 14. Temporary Storage Lifecycle

### 14.1 Workspace Directory Structure
- Root: `backend/.runtime/downloads/` (isolated, non-public).
- Per-job directory: `backend/.runtime/downloads/nexus_media_{job_id}/`.
- Intermediate files: `.f{format_id}.mp4.part`, `.temp.mp4`.
- Final local file: `{safe_title}.mp4`.

### 14.2 Multi-Stage Cleaner
1. **Immediate Cleanup:**
   - Web downloads: `BackgroundTask(_cleanup_temp, temp_dir)` deletes the directory when the `FileResponse` finishes streaming.
   - R2 uploads: `_cleanup_temp(temp_dir)` deletes the local file immediately after successful R2 upload.
2. **Periodic Reaper (`fallback_cleanup_task`):**
   - Runs every 15 minutes.
   - Scans `backend/.runtime/downloads/` for directories with `mtime` older than 2 hours.
   - Deletes abandoned temporary files.
3. **Startup Reconciliation:**
   - On backend process boot, checks `backend/.runtime/downloads/` and clears all orphaned directories.

---

## 15. Artifact Delivery

### 15.1 Delivery Modes & Authorization
1. **Mode A: Cloudflare R2 Presigned URLs (`r2_signed`) — PREFERRED**
   - Object key: `nexus-fallback/{job_id}/{filename}`.
   - URL: Signed `https://...r2.cloudflarestorage.com/...` with 24-hour expiration.
   - Benefits: Zero egress load on FastAPI server; direct delivery from Cloudflare edge.
2. **Mode B: Local Signed Token (`local_signed`) — FALLBACK**
   - Endpoint: `/api/fallback/{token}`.
   - Token: HMAC-SHA256 signed payload containing `path`, `filename`, `expires_at`.
   - Validated against Redis registry and HMAC secret before streaming.
3. **Mode C: Direct File Response (`direct_file`) — LEGACY WEB**
   - Endpoint: `/api/download/file/{job_id}`.
   - Hardened Authorization: Enforce that `current_user.id == job.user_id` or that caller provides a signed job token. Prevents IDOR unauthorized downloads.

---

## 16. Recovery / Startup Reconciliation

### 16.1 System Crash Recovery Flow
When the backend API or Celery worker boots:
1. **Orphaned Job Sweep:**
   - Query PostgreSQL: `SELECT id FROM public.jobs WHERE status IN ('downloading', 'processing', 'extracting')`.
   - These jobs were interrupted mid-execution by the crash.
   - Transition them to `FAILED` with failure code `WORKER_CRASH_ORPHANED`.
   - Trigger `refund_credits(user_id, job_id, cost)` to release their stranded Redis reservations.
2. **Pending Outbox Sweep:**
   - Query: `SELECT id FROM public.jobs WHERE status = 'queued' AND outbox_status = 'pending'`.
   - Re-publish to Celery `download_delivery_task`.
3. **Disk Reconciliation:**
   - Remove all directories in `backend/.runtime/downloads/nexus_media_*`.

---

## 17. Database Authoritative State

| Entity | Primary Authority | Secondary / Cache | Invalidation / Reconciliation |
| :--- | :--- | :--- | :--- |
| **Job Business State** | PostgreSQL (`public.jobs`) | Redis (`nexus:job:state:{id}`) | Redis mirrors DB; DB is source of truth |
| **Job Event Log** | PostgreSQL (`public.job_events`)| Redis (`nexus:job:events:{id}`) | Truncated to 100 in Redis; full in DB |
| **Active Deduplication** | PostgreSQL Unique Index | Redis (`nexus:job:dedupe:*`) | Redis key TTL 600s; DB constraint primary |
| **User Credits Balance** | PostgreSQL (`public.profiles`) | Redis (`tenant:{id}:credits`) | Read-through sync with 24h TTL |
| **Credit Reservations** | Redis (`tenant:{id}:reserved`) | None (ephemeral) | 30m reaper releases stranded keys |
| **Media History** | PostgreSQL (`media_history`) | LocalStorage (client cache) | Written only on verified completion |
| **Artifact State** | Cloudflare R2 / Local Disk | Redis (`fallback_artifact:*`) | 24h R2 lifecycle rule; 2h local reaper |

---

## 18. Observability & Telemetry

### 18.1 Structured Audit Logging
All fallback operations emit structured JSON logs with normalized schemas:
```json
{
  "event": "nexus_server_fallback",
  "job_id": "job_abc123",
  "user_id_hash": "e3b0c44298fc1c149afbf4c8996fb924",
  "strategy": "SERVER_FALLBACK",
  "fallback_reason": "WORKER_UNAVAILABLE",
  "provider": "youtube",
  "format_id": "137",
  "format_type": "video",
  "queue_latency_ms": 142,
  "execution_duration_ms": 4820,
  "ffmpeg_exit_code": 0,
  "download_bytes": 4323893,
  "status": "completed",
  "delivery_mode": "r2_signed"
}
```

### 18.2 Credential Scrubbing Guarantee
Log formatters strictly redact:
- Cookie headers and cookie file paths.
- Authorization bearer tokens and `sb-access-token`.
- Upstream URLs containing signed signature tokens (`&sig=`, `&token=`).
- Redis connection strings containing passwords.

---

## 19. Security Model & Trust Boundaries

```
[Untrusted Client]
        |
        | (HTTPS + JWT / Bearer Token)
        v
[Control Plane: FastAPI] ----------------- (Trusted Boundary)
        |
        +---> Outbound Fetch Policy (SSRF Prevention: Blocks RFC1918, 127.0.0.1, Metadata)
        |
        +---> Outbox Queue (Redis Broker with password auth)
        |
[Celery Render Workers] ------------------ (Isolated Sandbox)
        |
        +---> yt-dlp & FFmpeg (Restricted arguments, RLIMIT_AS memory limits)
        |
        +---> S3 / R2 Object Storage (Scoped IAM credentials)
        |
[Client Artifact Delivery] --------------- (Pre-signed URL / Auth-gated streaming)
```

---

## 20. Cost Model & Safeguards

1. **Client-First Dominance:** 85–95% of traffic flows through Phase 0, 1, 2, 3, 4 (Direct CDN, Cloudflare Worker Relay, Browser HLS). Server fallback handles only the ~5–15% edge cases.
2. **VPS Compute Boundedness:** Max 4 concurrent Celery render processes prevents CPU starvation on the backend host.
3. **Proxy Bandwidth Protection:** Cookie vault is checked first; proxy fallback is only used when vault accounts are exhausted.
4. **Zero-Egress Storage:** Completed fallback media uploaded to Cloudflare R2 has $0.00 egress bandwidth fees.

---

## 21. API Compatibility

All existing routes remain 100% backward-compatible:
- `POST /api/download-job`: Accepts existing payload (`url`, `format_id`, `format_type`, `delivery_target`). Returns `{"job_id": ..., "status": "queued", "runner": ...}`.
- `GET /api/progress/{job_id}`: Returns exact schema (`status`, `progress`, `speed`, `eta`, `download_url`, `size_bytes`).
- `GET /api/download/file/{job_id}`: Streams file to browser.
- `GET /api/fallback/{token}`: Resolves HMAC token and streams file.
- `POST /api/downloads/{job_id}/cancel`: Cancels download.

---

## 22. Frontend Compatibility & 23. Phase 4 Compatibility

1. **Web Frontend:**
   - [`downloaderService.ts`](file:///home/system/Desktop/Vidleo_intergrated/frontend/src/services/downloader/downloaderService.ts) lines 304–486 already implements the exact fallback sequence: tries `MediaEngine.execute()`, and on `null` or error, seamlessly falls back to `POST /api/download-job` and polls `/api/progress/{job_id}`.
   - **Zero frontend changes required.**
2. **Phase 4 Extension:**
   - Extension runs independently via Background Service Worker and Offscreen Document.
   - Extension consumes the shared MediaEngine and FastAPI `/api/resolve` endpoints.
   - Phase 4 is completely frozen and untouched.

---

## 24. Component Reuse Matrix

| Component | Status | Action in Phase 5 | Rationale |
| :--- | :---: | :---: | :--- |
| `backend/main.py` | Active | **ADAPT** | Add outbox dispatch; preserve all existing endpoints |
| `backend/strategy_engine.py` | Active | **KEEP** | Deterministic precedence ladder is already fully implemented |
| `backend/manifest_schema.py` | Active | **KEEP** | Manifest v1 schema intact |
| `backend/ticket_service.py` | Active | **KEEP** | HMAC ticket generation intact |
| `backend/outbound_policy.py` | Active | **REUSE** | Enforce SSRF validation on all fallback URLs |
| `backend/celery_app.py` | Active | **REUSE** | Celery queue configuration & worker hardening intact |
| `backend/tasks.py` | Active | **REUSE** | `download_delivery_task` intact |
| `backend/job_runner.py` | Active | **ADAPT** | Add active process tracking, cancellation killer, timeout limits |
| `backend/job_store.py` | Active | **EXTEND** | Add PostgreSQL outbox status, DB active dedupe index |
| `backend/storage_handler.py` | Active | **REUSE** | Cloudflare R2 presigned URLs and local HMAC fallback intact |
| `backend/cookie_vault.py` | Active | **REUSE** | Authentication cookie rotation intact |
| `backend/middleware/credit_gate.py` | Active | **ADAPT** | Add stranded reservation reaper sweep |
| `frontend/**` | Baseline | **PROTECTED** | 100% frozen; zero edits |
| `extension/**` | Baseline | **PROTECTED** | 100% frozen; zero edits |
| `worker/**` | Baseline | **PROTECTED** | 100% frozen; zero edits |

---

## 25. Production Readiness Questions (All 18 Answered)

### 1. Can two identical requests create two expensive jobs?
**YES (in current unhardened state)** if Redis is unavailable or claims expire before DB commit.  
**Mitigation:** Introduce PostgreSQL partial unique index on `(user_id, normalized_url, requested_format_id)` where status is active. DB constraint guarantees zero duplicate jobs regardless of Redis state.

### 2. Can quota be consumed twice?
**NO.** The Lua ledger function `check_and_reserve` performs an atomic decrement from `available` into `reserved` under `job_id`. `commit_credits()` is idempotent and only deducts once per `job_id`.

### 3. Can quota be lost permanently?
**YES (in current unhardened state)** if a worker process crashes mid-download, leaving credits stranded in `tenant:{user_id}:reserved`.  
**Mitigation:** Add an automated reaper in `billing_reconciliation_task` that refunds reservations older than 30 minutes for failed/crashed jobs.

### 4. Can a job disappear after DB commit but before queue publish?
**YES (in current unhardened state)** if the API server crashes between `register_job()` and `download_delivery_task.delay()`.  
**Mitigation:** Implement the Transactional Outbox pattern (`outbox_status = 'pending'`). A 60s background sweeper checks for pending outbox entries and re-publishes them to Celery.

### 5. Can a queue message exist without durable DB state?
**YES (in current unhardened state)** if `_sync_job_row()` fails silently in the background while Celery dispatch succeeds.  
**Mitigation:** Ensure the DB transaction commits synchronously *before* the message is dispatched to Celery.

### 6. Can FFmpeg run forever?
**YES (in current unhardened state)** because `process.wait()` in `download_handler.py` has no timeout argument.  
**Mitigation:** Enforce explicit timeout (`process.wait(timeout=300)`) with SIGTERM &rarr; SIGKILL escalation, plus Celery `task_time_limit=1800`.

### 7. Can one user exhaust worker resources?
**YES (in current unhardened state)** because rate limits allow 5 jobs/min, occupying all 4 Celery worker slots.  
**Mitigation:** Enforce per-user active concurrency limit: max 2 active jobs per user (`COUNT(*) ... status IN ('queued', 'downloading', 'processing')`).

### 8. Can cancelled jobs continue consuming CPU?
**YES (in current unhardened state)** because `_ensure_not_cancelled` is only checked before/after `download_selected_media()`, not during the subprocess execution.  
**Mitigation:** Active process registry tracks running PIDs. When `/cancel` is called, `process.terminate()` / `process.kill()` and `celery_app.control.revoke()` are immediately issued.

### 9. Can failed jobs leave large temporary files?
**YES (in current unhardened state)** if a worker is killed with `SIGKILL` or if a user abandons `/download/file/{job_id}` without downloading.  
**Mitigation:** Periodic disk reaper running every 15 minutes purges any directory in `.runtime/downloads/` older than 2 hours.

### 10. Can a restart orphan jobs?
**YES (in current unhardened state)** because in-memory state is lost and Redis keys remain marked `downloading`.  
**Mitigation:** Startup reconciliation hook queries PostgreSQL for non-terminal jobs on boot and marks them `FAILED` with code `SERVER_RESTART_ORPHANED`, refunding credits.

### 11. Can an attacker force SSRF through fallback?
**YES (in current unhardened state)** if yt-dlp follows unvalidated HTTP redirects to internal/cloud metadata IPs.  
**Mitigation:** Enforce pre-execution DNS pinning and outbound URL validation via `backend/outbound_policy.py`, and pass `--abort-on-error` to prevent following malicious redirect hops.

### 12. Can an attacker access another user's artifact?
**YES (in current unhardened state)** via `/api/download/file/{job_id}` if the `job_id` is guessed or leaked.  
**Mitigation:** Enforce user authorization check (`user.id == job.user_id`) on `/api/download/file/{job_id}`.

### 13. Can expired artifacts remain accessible?
**YES (in current unhardened state)** on `/api/download/file/{job_id}` if the file remains on disk.  
**Mitigation:** Check `job.expires_at` on `/api/download/file/{job_id}` and return 410 Gone if expired.

### 14. Can retries multiply cost?
**YES (in current unhardened state)** if client retries `POST /api/download-job` repeatedly.  
**Mitigation:** Deduplication returns existing job without charging; retry policy strictly prohibits retrying deterministic failures (404, invalid codec).

### 15. Can a client falsely claim successful completion?
**NO.** For server-side fallback jobs, status is updated to `completed` and credits are committed exclusively by `job_runner.py` on the server, never by client input.

### 16. Can server fallback accidentally become an open proxy?
**YES (in current unhardened state)** if arbitrary non-media URLs are accepted and fetched.  
**Mitigation:** Strict domain allowlist / provider matching (`get_provider_capability()`) and yt-dlp format validation. Arbitrary file URLs rejected.

### 17. Can a malformed input crash a worker?
**YES (in current unhardened state)** if extremely large input or infinite feed URL causes memory exhaustion.  
**Mitigation:** Block infinite feed regexes, enforce `_MAX_URL_LENGTH = 2048`, and cap worker process memory at 512 MB.

### 18. Can production secrets reach the client?
**YES (in current unhardened state)** if yt-dlp CLI error output containing proxy credentials or cookies is echoed in `job.error`.  
**Mitigation:** Comprehensive error sanitizer scrubs credentials, file paths, and internal IPs before storing error strings.

---

## 26. Proposed Implementation Order

Once approved, Phase 5 will be executed in the following strict sequential steps:

1. **Step 1 — Database Schema Hardening:**
   - Add `outbox_status`, `outbox_dispatched_at`, `expires_at` to `public.jobs`.
   - Add partial unique index `idx_jobs_active_dedupe` on active jobs.
2. **Step 2 — Outbox & Reliable Queue Handoff:**
   - Update `main.py` to write `outbox_status = 'pending'` within DB transaction before Celery dispatch.
   - Implement outbox sweeper task for orphaned pending jobs.
3. **Step 3 — Active Process Tracking & Cooperative Cancellation:**
   - Track `subprocess.Popen` instances in `ACTIVE_PROCESSES`.
   - Hook `/api/downloads/{job_id}/cancel` to kill subprocess and revoke Celery task.
4. **Step 4 — Subprocess Timeouts & FFmpeg Safety:**
   - Add explicit `timeout=300` to `process.wait()`.
   - Add resource limits (512 MB memory cap, 2 threads).
5. **Step 5 — Quota & Stranded Reservation Reaper:**
   - Add timestamp to Redis reservation hash.
   - Add reservation reaper in `billing_reconciliation_task`.
6. **Step 6 — Storage Lifecycle & Multi-Stage Cleanup:**
   - Connect 15m reaper to clean `.runtime/downloads/` folders older than 2 hours.
   - Add startup reconciliation hook.
7. **Step 7 — IDOR Protection & Endpoint Security:**
   - Authorize user access on `/api/download/file/{job_id}`.
   - Scrub sensitive credentials from error messages.
8. **Step 8 — Full Master Regression Suite Execution:**
   - Frontend protection gate (5/5 PASS).
   - Phase 1 control plane suite (14/14 PASS).
   - Phase 2 live edge security suite (13/13 PASS).
   - Phase 3 unit & failure suites (28/28 & 30/30 PASS).
   - Phase 4 extension E2E sanity test (8/8 PASS).
   - Next.js production build (`npm run build` static export 34/34 pages).
9. **Step 9 — Production Verification & Documentation.**

---

## 27. Definition of Done

Phase 5 will be considered **DONE** only when:
1. `SERVER_FALLBACK` triggers deterministically only when preceding client-first strategies are unavailable.
2. Every fallback carries an immutable `fallback_reason`.
3. Two identical concurrent requests return the same `job_id` without spawning duplicate FFmpeg processes.
4. Quota reservation and commit are atomic; zero credit leaks on crash or cancellation.
5. All FFmpeg and yt-dlp subprocesses have hard timeouts and active cancellation termination.
6. Temporary storage is automatically reclaimed with zero permanent disk leakage.
7. No secrets or credentials leak in error messages or logs.
8. Protected baselines (`frontend/src/app/**`, `components/**`, `downloaderService.ts`, `worker/**`, `extension/**`) remain 100% untouched.
9. Next.js production build compiles with zero errors (34/34 pages static export).
10. All 18 production readiness gates pass.
