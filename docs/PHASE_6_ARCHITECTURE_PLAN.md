# NEXUS Phase 6 — Architecture & Production Readiness Plan

**Document Version:** 1.0.0  
**Status:** `ARCHITECTURE GATE ONLY — IMPLEMENTATION NOT AUTHORIZED`  
**Date:** September 27, 2026  
**Prerequisites:** Phase 0–5 Fully Validated & Frozen

---

## 1. Current Verified Architecture

Following the completion of Phases 0 through 5, the NEXUS media delivery platform operates with a hybrid, multi-tier execution topology:

```
                                  +---------------------------------------+
                                  |         Client Web App / Extension     |
                                  |   (Next.js 14 / Manifest V3 MV3)      |
                                  +-------------------+-------------------+
                                                      |
                                      1. Request Info / Manifest
                                                      |
                                                      v
                                  +---------------------------------------+
                                  |         FastAPI Control Plane         |
                                  |  (manifest_builder, strategy_engine)  |
                                  +-------------------+-------------------+
                                                      |
                         +----------------------------+----------------------------+
                         |                                                         |
                         v                                                         v
        [Client-Side Strategy Paths]                              [Server Fallback Path (Phase 5)]
        1. DIRECT_PROGRESSIVE                                      1. Idempotent Job Registration
        2. DIRECT_RANGE                                            2. Transactional Outbox (PostgreSQL)
        3. BROWSER_ADAPTIVE_MUX                                    3. Double-Entry Credit Reservation
        4. SIGNED_WORKER_RANGE (Cloudflare Worker Relay 206)       4. Celery Queue / Sharded Workers
        5. BROWSER_HLS (fMP4/TS Demuxer + OPFS Sink)              5. FFmpeg / yt-dlp Subprocess (900s timeout)
                         |                                         6. Process Registry (ACTIVE_PROCESSES)
                         |                                         7. R2 Delivery Artifact or Local Fallback
                         +----------------------------+----------------------------+
                                                      |
                                                      v
                                  +---------------------------------------+
                                  |     Authenticated Delivery & Sink     |
                                  |  (IDOR Protected, Expiration 410 TTL) |
                                  +---------------------------------------+
```

### Core Verified Subsystems:
1. **Control Plane (`backend/`):** FastAPI app with deterministic strategy selection, HMAC-SHA256 token issuance (`ticket_service.py`), and rate-limited API access.
2. **Edge Relay (`worker/`):** Cloudflare Worker enforcing strict host white-listing, URL hash validation, resource typing (`typ=range`, `typ=playlist`, `typ=segment`), and streaming Range 206 responses.
3. **Browser Engine (`frontend/src/packages/media-engine/`):** In-browser demuxing and packaging (fMP4, TS, MP4Box) streaming directly into the Origin Private File System (OPFS) with bounded memory consumption (< 3 MB heap growth for 200 MB+ files).
4. **Browser Extension (`extension/`):** Chromium Manifest V3 service worker and offscreen document reusing the shared media engine contract with zero frontend pollution.
5. **Governed Server Fallback (`backend/`):** Transactional outbox for guaranteed dispatch, stranded credit reservation reaper, active process cancellation with SIGTERM/SIGKILL escalation, 900s process timeouts, and disk reaper cleanup.

---

## 2. Completed Phases 0–5 Summary

- **Phase 0 (Feasibility):** Proved browser-side Range fetching, OPFS writing, demuxing, and FFmpeg decode compatibility with zero decode errors.
- **Phase 1 (Thin Slice):** Verified Manifest v1 schemas, Strategy Engine determinism, and ticket issuance/validation with 14/14 tests passing.
- **Phase 2 (Worker Relay):** Deployed and validated live Cloudflare Worker relay (`https://nexus-media-relay.vidleo-relay.workers.dev/relay`) with Range 206 streaming and 13/13 edge security tests passing.
- **Phase 3 (Browser HLS):** Implemented client-side HLS playlist parsing, byte-range segment fetching, and fMP4 packaging with 73/73 tests passing.
- **Phase 4 (MV3 Extension):** Built Chromium Manifest V3 extension with isolated Offscreen runner and least-privilege permissions, verified on Chromium 153.
- **Phase 5 (Backend Hardening):** Implemented PostgreSQL transactional outbox, reservation reaper, active process registry, FFmpeg timeouts, disk reapers, IDOR controls, and credential scrubbing with 19/19 tests passing.

---

## 3. Remaining Gaps Identified Post-Phase 5

While functional logic and core resiliency are verified, moving to high-volume production reveals operational and admission control gaps:

1. **Production Observability & Metrics:** Currently relying on standard Python logging and console outputs. Prometheus metrics are partially scaffolded but lack unified grafana dashboards for outbox latency, reaper refunds, and worker queue depths.
2. **Admission Control & Queue Backpressure:** When Celery queues back up during upstream provider throttling (e.g. YouTube rate limits), new fallback jobs continue to enter the queue without dynamic admission throttling.
3. **Upstream Circuit Breaker Synchronization:** Circuit breakers exist in `proxy_state.py` but operate mostly in-memory/per-worker rather than dynamically propagating trip states globally across all edge and control plane nodes.
4. **Disaster Recovery & Outbox Queue Pruning:** The outbox table will accumulate historical rows indefinitely without a dedicated archival and retention pruning job.
5. **Rate-Limiting Multi-Tenant Tier Enforcement:** API rate limits currently enforce basic burst counts but need strict concurrency caps per subscription tier at the API gateway layer.

---

## 4. Comprehensive Risk Matrix

| Risk ID | Description | Impact | Probability | Mitigation Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **R-01** | Upstream provider IP blocking / 429 throttling under high concurrency. | High | Medium | Proxy pool rotation, adaptive backoff, and circuit breaker trip notifications. |
| **R-02** | Celery worker saturation causing high outbox sweeper retry cycles. | Medium | Medium | Dynamic queue depth monitoring and admission rejection at API entrypoint. |
| **R-03** | PostgreSQL outbox table bloat over months of operation. | Low | High | Automated daily partitioning or scheduled archival pruning of terminal rows. |
| **R-04** | Cloudflare Worker CPU / subrequest quota exhaustion under extreme HLS load. | High | Low | Client-side segment caching and Cloudflare Enterprise tiered caching rules. |
| **R-05** | Storage disk leak from non-standard temporary file names. | Low | Low | Enforced prefix validation in disk reaper (`nexus_media_*`). |

---

## 5. Prioritization Matrix (P0 / P1 / P2)

### Priority P0 — Critical for Safe Launch:
- **P0-1:** Outbox and job table automated archival / pruning (retention policy).
- **P0-2:** Global queue backpressure & dynamic admission control (reject with 503/429 when queue depth > threshold).
- **P0-3:** Distributed Prometheus metrics export for outbox latency, Celery worker states, and reservation refunds.

### Priority P1 — Operational Hardening:
- **P1-1:** Global proxy circuit breaker state synchronization via Redis pub/sub.
- **P1-2:** Automated synthetic health checks and canary probe endpoints (`/api/health/deep`).
- **P1-3:** Production Grafana dashboard configurations and alert manager rules (SLO alert thresholds).

### Priority P2 — Long-Term Scale & Cost Efficiency:
- **P2-1:** Cloudflare Worker edge cache tuning for manifest playlists.
- **P2-2:** Automated R2 lifecycle rules for direct delivery artifact expiration.

---

## 6. Production Operations & Runbooks

Phase 6 must establish standardized operational procedures:
- **Worker Drain Procedure:** Gracefully pausing job consumption, allowing active FFmpeg tasks up to 900s to complete, and shutting down Celery workers without stranding jobs.
- **Emergency Circuit Breaker Trigger:** Administrative CLI or API to immediately pause server fallback downloads during an upstream provider incident, directing all traffic to browser-direct or extension paths.
- **Stale Credit Reconciliation Manual Trigger:** Operational runbook for manually invoking `run_reservation_reaper()` and auditing refunded user accounts.

---

## 7. Observability Architecture

```
FastAPI Control Plane  --->  Prometheus Client  --->  /metrics endpoint
Celery Worker Tasks    --->  StatsD / Prometheus  --->  Prometheus Server  --->  Grafana Dashboards
Outbox Sweeper Loop    --->  Gauge: outbox_pending_count
Reaper Loop            --->  Counter: reaper_refunds_total
Process Registry       --->  Gauge: active_ffmpeg_processes
```

Key SLO Metrics:
- **Availability SLO:** 99.9% successful responses on `/api/info` and `/api/download-job`.
- **Latency SLO:** P95 Manifest generation < 1200ms.
- **Outbox Dispatch Latency:** P95 time from DB commit to Celery acknowledgement < 2.0s.
- **Process Leak Zero Tolerance:** `active_ffmpeg_processes == 0` when zero jobs are in `downloading` state.

---

## 8. Performance & Capacity Engineering

- Concurrency targets: 50 concurrent active server-side fallbacks per node (bounded by 2 CPU threads per process and 5GB disk bounds).
- Memory profile: FastAPI control plane < 256MB RSS; Celery worker child processes < 512MB RSS.
- Subprocess concurrency limiter: Semaphore bounded to `min(CPU_COUNT * 2, 16)` active FFmpeg conversions simultaneously per host.

---

## 9. Reliability & Fault Tolerance

- **Zero Lost Jobs:** Ensured by the Transactional Outbox.
- **Zero Orphaned Tasks:** Ensured by `ACTIVE_PROCESSES` registry and SIGTERM/SIGKILL timeout guards.
- **Zero Stranded Credits:** Ensured by `reservation_reaper.py` running every 15 minutes.
- **Idempotency Guarantee:** Duplicate submissions within the 10-minute active window are coalesced into the existing job record.

---

## 10. Security & Hardening Boundaries

- **Zero Trust Edge Relay:** Cloudflare Worker rejects all requests without valid, unexpired HMAC-SHA256 tickets.
- **SSRF Defense:** `outbound_policy.py` DNS resolution blocks loopback, RFC1918, RFC6598, and cloud metadata IPs (`169.254.169.254`).
- **IDOR Protection:** Ownership verification enforced on all file delivery and cancellation endpoints.
- **Credential Redaction:** `scrub_error` active on all error logs and client-facing error payloads.

---

## 11. Disaster Recovery & Data Integrity

- Database backups: Nightly automated logical dumps of Supabase PostgreSQL schema and profiles.
- Rollback safety: All DB migrations (including 027) have documented, non-destructive rollback steps.
- Redis state recovery: Redis contains transient cache, rate limits, and reservation locks; if Redis suffers data loss, the PostgreSQL job table and `reconcile_orphaned_jobs()` automatically reconstruct consistent state.

---

## 12. Cost Controls

- Free tier: Restricted to 360p/720p client-side progressive or adaptive muxing (0 server compute or storage cost).
- Pro/Owner tier: Server-side fallback permitted up to 4K resolution; costs deducted from double-entry credit ledger.
- Worker relay: Restricted to 50MB per range request; client-side caching minimizes relay bandwidth costs.

---

## 13. Infrastructure Impact Analysis

| System | Resource Impact | Mitigation |
| :--- | :--- | :--- |
| **PostgreSQL** | Moderate (outbox polling queries every 60s) | Partial index `idx_jobs_outbox_pending` scans only pending rows (0 rows in steady state). |
| **Redis** | Minimal (hash scans for stale reservations) | Key pattern scanning uses `scan_iter` cursor to prevent blocking event loop. |
| **Local Disk** | Bounded (temporary download folders) | Pruned immediately upon completion; orphaned folders pruned after 2 hours. |
| **Network** | Bounded | Direct client downloads offload 90%+ of traffic from backend servers. |

---

## 14. API Impact Assessment

- **Existing APIs:** No breaking changes to `/api/download-job`, `/api/progress/{job_id}`, or `/api/download/file/{job_id}`.
- **New Endpoints Proposed for Phase 6:**
  - `GET /api/health/deep` — Deep readiness probe checking DB, Redis, Celery, and FFmpeg binary.
  - `GET /metrics` — Standard Prometheus scrape endpoint.

---

## 15–18. Baseline Protection Verification

- **Frontend Impact:** 0 changes to `frontend/src/app/**` or `downloaderService.ts`.
- **Extension Impact:** 0 changes to `extension/src/**`.
- **Worker Impact:** 0 changes to `worker/src/**`.
- **Database Impact:** Migration 027 already deployed in backward-compatible state; Phase 6 introduces no schema rewrites.

---

## 19. Implementation Order for Phase 6 (When Authorized)

```
Step 1: Deep Health Check Endpoint (/api/health/deep)
Step 2: Prometheus Metrics Exporter & SLO Dashboards
Step 3: Admission Control & Queue Backpressure Gate
Step 4: Outbox Table Periodic Archival / Retention Pruning
Step 5: Distributed Proxy Circuit Breaker Synchronization
Step 6: Synthetic Chaos & Load Testing (50 Concurrency)
Step 7: Production Staging Validation
```

---

## 20. Testing & Verification Strategy

- Automated unit testing for new metrics and health endpoints.
- Chaos injection: Network partition simulation between Control Plane and Celery worker.
- Load testing: Graduated load tests at 1, 5, 10, 25, and 50 concurrent fallback requests.

---

## 21. Rollback Strategy

Every Phase 6 operational enhancement must be gated by environment variables (e.g., `NEXUS_ADMISSION_CONTROL_ENABLED=0`, `NEXUS_METRICS_ENABLED=0`) allowing instant zero-downtime disabling without code rollback.

---

## 22. Definition of Done for Phase 6

Phase 6 will be complete only when:
1. Deep health check (`/api/health/deep`) validates DB, Redis, and Celery connectivity.
2. Prometheus `/metrics` exports real-time outbox latency and active job counts.
3. Queue backpressure safely rejects or defers jobs when worker queues are saturated.
4. Outbox retention pruning successfully purges terminal rows older than 7 days.
5. All Phase 0–5 regressions continue to pass at 100%.
6. Human approval is granted for production deployment.

---

## 23. HARD STOP

**In strict accordance with user instructions:**
- Phase 6 architecture plan is completed and documented.
- **NO Phase 6 implementation has been started.**
- **NO production infrastructure has been altered.**
- Execution is STOPPED awaiting human review and authorization.
