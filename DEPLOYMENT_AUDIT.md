# Vidleo / NEXUS Production Deployment Audit (Phase 0)

Date: October 5, 2026
Repository: https://github.com/kaveri17-D/Vidleo_HQ_kaveri
Branch: main
Local Working Directory: /home/system/Desktop/Vidleo_intergrated

---

## 1. Executive Summary & Detected Services

| Service / Layer | Technology | Primary Directory | Deployment Target | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend** | Next.js 14.2.15, React 18.3.1, Tailwind CSS | `frontend/` | Vercel | Verified & Audit Complete |
| **Backend API** | FastAPI 0.111.0, Uvicorn 0.29.0, Python 3.11+ | `backend/` | Railway (or Container Runtime) | Verified & Audit Complete |
| **Background Worker** | Celery 5.4.0 (Queues: `meta`, `render`, `syndicate`, `maintenance`) | `backend/celery_app.py`, `backend/tasks.py` | Railway / Worker Container | Verified & Audit Complete |
| **Database & Auth** | PostgreSQL via Supabase (PostgREST, Auth `auth.users`, RLS) | `backend/sql/*.sql`, `frontend/supabase-admin-setup.sql` | Managed Supabase / PostgreSQL | Verified & Audit Complete |
| **Cache & Queue Broker** | Redis 7+ | N/A | Managed Redis (Railway / Upstash) | Verified & Audit Complete |
| **Edge Worker** | Cloudflare Workers (`nexus-media-relay`, TypeScript) | `worker/` | Cloudflare Workers | Verified & Audit Complete |
| **Object Storage** | Cloudflare R2 (S3-compatible, presigned URLs via Boto3) | `backend/storage_handler.py` | Cloudflare R2 | Verified & Audit Complete |
| **Browser Extension** | Chrome Manifest V3 Companion | `extension/` | Local Package / Chrome Web Store | Built & Validated in `extension/dist` |

---

## 2. Verified Commands by Service

### Frontend (`frontend/`)
- **Framework**: Next.js 14 (App Router)
- **Package Manager**: `npm`
- **Install Command**: `npm install`
- **Build Command**: `next build` (or `npm run build`)
- **Start Command**: `next start`
- **Node.js Requirement**: Node.js 18.17+ or 20+ LTS

### Backend API (`backend/`)
- **Framework**: FastAPI
- **Entrypoint**: `backend.main:app` (from repo root) or `main:app` (from `backend/` directory)
- **Start Command (Production)**:
  ```bash
  uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
  ```
- **Python Version Requirement**: Python 3.11+ (official container base: `python:3.11-slim`)
- **System Dependencies**: `ffmpeg`, `curl`, `nodejs`, `ca-certificates`

### Background Worker (Celery)
- **Entrypoint**: `backend.celery_app`
- **Start Command (Consolidated Worker)**:
  ```bash
  celery -A backend.celery_app worker --loglevel=info -Q meta,render,syndicate,maintenance_worker
  ```
- **Start Command (Celery Beat - Scheduled Rollups)**:
  ```bash
  celery -A backend.celery_app beat --loglevel=info
  ```

### Cloudflare Edge Worker (`worker/`)
- **Entrypoint**: `src/index.ts`
- **Build Command**: `npm run build` (`tsc`)
- **Deploy Command**: `npx wrangler deploy`

### Extension Companion (`extension/`)
- **Manifest**: Manifest V3 (`manifest.json`)
- **Build Command**: `node build.mjs`
- **Output Artifact**: `extension/dist/` (`manifest.json`, `background.js`, `offscreen.js`, `popup.js`, HTML assets)

---

## 3. Database Architecture & Migrations

- **Database Engine**: PostgreSQL, integrated with Supabase.
- **ORM / Migrations Engine**:
  - **Alembic is NOT used** in this repository (verified via repository-wide search).
  - Schema migrations are modular SQL DDL scripts located in `backend/sql/`:
    - `001_owner_system_foundation.sql` through `028_grant_premium_kaveridoye5.sql`
    - `backend/migrations/fix_rls.sql`
    - `frontend/supabase-admin-setup.sql` (Profiles, user roles, RLS policies)
- **Backend Data Access**: PostgREST HTTP queries via `backend/supabase_client.py` and JWT verification via `SUPABASE_JWT_SECRET`.

---

## 4. Redis Architecture

- **Engine**: Redis 7.x
- **Config Variable**: `REDIS_URL` (e.g. `redis://default:<password>@<host>:<port>/0`)
- **Subsystems Utilizing Redis**:
  1. Celery message broker (`CELERY_BROKER_URL`) and result store (`CELERY_RESULT_BACKEND`).
  2. SlowAPI rate limiter (`Limiter(storage_uri=...)`).
  3. Proxy health telemetry, circuit breaker tripping and half-open state tracking.
  4. Dynamic pricing runtime cache.
  5. Fallback download artifact registry & job outbox tracking.

---

## 5. Environment Variables Specification

### Frontend (`frontend/`)
| Variable | Type | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_VIDLEO_API_URL` | Public | Production Backend API URL (e.g., `https://api.vidleo.app` or Railway URL) |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase Project URL (`https://<project-id>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase Anonymous Client Key |
| `NEXT_PUBLIC_DISABLE_WORKER_RELAY` | Public (Optional) | Boolean flag (`"false"` for production edge relay) |
| `NEXT_PUBLIC_NEXUS_BROWSER_HLS_ENABLED` | Public (Optional) | Boolean flag (`"true"` for browser HLS pipeline) |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Server-side only key for `/api/admin/data` |
| `INITIAL_ADMIN_EMAIL` | Secret (Optional) | Fallback bootstrap administrator email |

### Backend (`backend/`)
| Variable | Type | Description |
| :--- | :--- | :--- |
| `PORT` | Public / System | Dynamic HTTP port provided by host / Railway |
| `ALLOWED_ORIGINS` | Public | Comma-separated list of allowed CORS origins (e.g., `https://vidleo.app,https://<app>.vercel.app`) |
| `NEXUS_CORS_OWNER` | Config | Set to `app` so FastAPI explicitly enforces CORS |
| `NEXUS_WEB_URL` | Public | Production Frontend URL |
| `REDIS_URL` | Secret | Redis connection string |
| `CELERY_BROKER_URL` | Secret (Optional) | Defaults to `REDIS_URL` |
| `CELERY_RESULT_BACKEND` | Secret (Optional) | Defaults to `REDIS_URL` |
| `NEXUS_USE_CELERY` | Config | Set to `1` in production |
| `SUPABASE_URL` | Secret / Config | Supabase endpoint URL |
| `SUPABASE_ANON_KEY` | Public | Supabase anon key |
| `SUPABASE_SERVICE_KEY` | Secret | Supabase service role key for table access |
| `SUPABASE_JWT_SECRET` | Secret | Secret for decoding and verifying user session tokens |
| `ADMIN_SECRET_KEY` | Secret | Random high-entropy token for admin API exemption |
| `SIGNED_DOWNLOAD_SECRET` | Secret | Shared HMAC secret between Backend and Cloudflare Worker |
| `NEXUS_DEEP_HEALTH_ENABLED` | Config | Set to `true` to enable `/api/health/deep` |
| `NEXUS_METRICS_ENABLED` | Config | Set to `true` to enable `/metrics` |
| `R2_BUCKET` | Config | Cloudflare R2 Bucket name |
| `R2_ENDPOINT_URL` | Config | Cloudflare R2 S3 API endpoint URL |
| `R2_ACCESS_KEY_ID` | Secret | Cloudflare R2 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | Secret | Cloudflare R2 Secret Access Key |
| `R2_REGION` | Config | Set to `auto` |
| `R2_PUBLIC_DOMAIN` | Public (Optional) | Custom domain for R2 downloads if public |

### Cloudflare Worker (`worker/`)
| Variable | Type | Description |
| :--- | :--- | :--- |
| `ALLOWED_ORIGIN` | Public | Comma-separated allowed origins or domain list |
| `SIGNED_DOWNLOAD_SECRET` | Secret | Shared HMAC secret (must match Backend) |
| `MAX_RANGE_BYTES` | Config | Maximum byte size per Range slice (default `52428800`) |

---

## 6. Health & Observability Endpoints

1. **Liveness Probe**:
   - `GET /api/health`
   - Returns service status, active job metrics, fallback cleanup statistics, and proxy telemetry.
2. **Deep Readiness Probe**:
   - `GET /api/health/deep`
   - Requires `NEXUS_DEEP_HEALTH_ENABLED=true`.
   - Probes: Application Memory, Supabase / PostgreSQL, Redis, Celery, Object Storage, System Binaries (FFmpeg/yt-dlp), and Circuit Breakers.
3. **Prometheus Metrics**:
   - `GET /metrics`
   - Requires `NEXUS_METRICS_ENABLED=true`.

---

## 7. Security & Isolation Audit

- **No Committed Secrets**: `.env` and `.env.*` are excluded by root and service `.gitignore` files.
- **SSRF Hardening**: Cloudflare Worker enforces strict IP, protocol, and hostname validation in `worker/src/ssrf.ts`.
- **Signed Tickets**: All media operations require HMAC-SHA256 signed tokens verified in `backend/ticket_service.py` and `worker/src/ticket.ts`.
- **CORS Isolation**: Configurable via `ALLOWED_ORIGINS` and `NEXUS_CORS_OWNER=app`. No `*` wildcard in production backend.

---

## 8. Deployment Plan

1. **Phase 1**: Frontend Deployment to Vercel (`frontend/`).
2. **Phase 2 & 3**: Provision Managed PostgreSQL (via Supabase) and Redis (via Railway/managed).
3. **Phase 4**: Deploy FastAPI Backend (`backend/`) on Railway/Container Runtime with production configuration.
4. **Phase 5**: Deploy Celery Background Worker (`backend/celery_app.py`).
5. **Phase 6**: Link Frontend and Backend via `NEXT_PUBLIC_VIDLEO_API_URL` and `ALLOWED_ORIGINS`.
6. **Phase 7 & 8**: Verify Cloudflare Worker (`nexus-media-relay`) and R2 configuration.
7. **Phase 9**: Build and package Chrome Extension Companion (`extension/dist`).
8. **Phase 10 & 11**: Production security audit and end-to-end smoke test.
9. **Phase 12 & 13**: Generate `docs/PRODUCTION_DEPLOYMENT.md` and commit deployment configurations.
