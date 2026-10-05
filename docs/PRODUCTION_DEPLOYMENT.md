# Vidleo / NEXUS Production Deployment Guide

**Version**: 1.0.0  
**Updated**: October 5, 2026  
**Repository**: `https://github.com/kaveri17-D/Vidleo_HQ_kaveri`  
**Branch**: `main`  

---

## 1. Production Architecture Overview

The Vidleo NEXUS system is architected as a distributed, high-performance media processing and web platform:

```
[ Clients / Web Users / Browser Extension ]
                   │
                   ▼
       [ Cloudflare Edge Layer ]
       ├── nexus-media-relay (Cloudflare Worker: ticket validation & range relay)
       └── R2 Object Storage (Presigned URL downloads / artifact persistence)
                   │
                   ├──────────────────────────────────┐
                   ▼                                  ▼
      [ Vercel Frontend ]                    [ Railway / Container API ]
      Next.js 14 Web Application             FastAPI 0.111.0 Control Plane
      (Client-first UI & SSR API routes)    (Admission control, tickets, metrics)
                   │                                  │
                   └──────────────────┬───────────────┘
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
        [ Supabase / PostgreSQL ]                 [ Managed Redis ]
        Profiles, Auth (`auth.users`),           Celery Broker, Rate Limiting,
        User Roles, Billing & Audit Logs         Pricing Cache & Circuit Breakers
                                                         │
                                                         ▼
                                              [ Celery Workers & Beat ]
                                              Heavy transcode, muxing, syndication,
                                              maintenance & hourly reconciliation
```

---

## 2. Service Inventory & Endpoints

| Component | Provider / Host | Entrypoint / Command | Production Target URL / Domain |
| :--- | :--- | :--- | :--- |
| **Frontend** | Vercel | `next build` / `next start` | `https://vidleo.app` (or `https://vidleo-hq-kaveri.vercel.app`) |
| **Backend API** | Railway / Docker | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` | `https://api.vidleo.app` (or Railway assigned HTTPS domain) |
| **Worker (Celery)** | Railway / Docker | `celery -A backend.celery_app worker -Q meta,render,syndicate,maintenance_worker` | Internal service (no public HTTP port) |
| **Worker (Beat)** | Railway / Docker | `celery -A backend.celery_app beat --loglevel=info` | Internal service |
| **Database & Auth** | Supabase (PostgreSQL) | Managed PostgREST & Auth Engine | `https://<supabase-project-id>.supabase.co` |
| **Redis Cache/Queue** | Railway / Upstash | Managed Redis 7.x | Private / TLS `redis://...` |
| **Edge Relay** | Cloudflare Workers | `src/index.ts` via `wrangler` | `https://nexus-media-relay.vidleo-relay.workers.dev` |
| **Object Storage** | Cloudflare R2 | S3-compatible API via Boto3 | `https://<account-id>.r2.cloudflarestorage.com/<bucket>` |
| **Browser Extension** | Chrome Web Store | Manifest V3 bundle (`extension/dist/`) | Chrome Extension ID / Store Package |

---

## 3. Environment Variables (NAMES ONLY — NO SECRETS)

### A. Frontend (Vercel)
- `NEXT_PUBLIC_VIDLEO_API_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_DISABLE_WORKER_RELAY`
- `NEXT_PUBLIC_NEXUS_BROWSER_HLS_ENABLED`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INITIAL_ADMIN_EMAIL`

### B. Backend API (Railway)
- `PORT`
- `ALLOWED_ORIGINS`
- `NEXUS_CORS_OWNER` (Set to `app`)
- `NEXUS_WEB_URL`
- `REDIS_URL`
- `REDIS_PASSWORD` (Optional)
- `CELERY_BROKER_URL`
- `CELERY_RESULT_BACKEND`
- `NEXUS_USE_CELERY`
- `NEXUS_USE_CELERY_BEAT`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `SUPABASE_JWT_SECRET`
- `ADMIN_SECRET_KEY`
- `SIGNED_DOWNLOAD_SECRET`
- `NEXUS_DEEP_HEALTH_ENABLED`
- `NEXUS_METRICS_ENABLED`
- `R2_BUCKET`
- `R2_ENDPOINT_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_REGION`
- `R2_PUBLIC_DOMAIN`
- `PROXY_URL` (Optional)
- `COOKIES_FILE` (Optional)
- `RAZORPAY_KEY_ID` (Optional)
- `RAZORPAY_KEY_SECRET` (Optional)
- `RAZORPAY_WEBHOOK_SECRET` (Optional)
- `DISCORD_BOT_TOKEN` (Optional)
- `TELEGRAM_BOT_TOKEN` (Optional)

### C. Background Worker (Railway)
- `REDIS_URL`
- `CELERY_BROKER_URL`
- `CELERY_RESULT_BACKEND`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SIGNED_DOWNLOAD_SECRET`
- `R2_BUCKET`
- `R2_ENDPOINT_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

### D. Cloudflare Worker (`nexus-media-relay`)
- `ALLOWED_ORIGIN`
- `SIGNED_DOWNLOAD_SECRET`
- `MAX_RANGE_BYTES`

---

## 4. Database Migration Procedure

1. **Database Platform**: PostgreSQL via Supabase.
2. **Schema Files**: Modular SQL files located in `backend/sql/`:
   - `001_owner_system_foundation.sql` to `028_grant_premium_kaveridoye5.sql`
   - `frontend/supabase-admin-setup.sql` (Profiles, roles, and RLS policies)
   - `backend/migrations/fix_rls.sql`
3. **Execution Steps**:
   - Access the Supabase Dashboard -> **SQL Editor**.
   - Execute the SQL migration scripts sequentially (or via `psql $SUPABASE_DB_URL -f ...`).
   - Confirm table creation: `profiles`, `user_roles`, `api_keys`, `user_credit_grants`, `referral_events`.
   - Verify RLS policies are enabled on all user tables.

---

## 5. Deployment Procedures

### Step 1: Vercel Frontend Deployment
1. Log into Vercel and import GitHub repository: `https://github.com/kaveri17-D/Vidleo_HQ_kaveri`.
2. Configure Project Settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend`
   - **Production Branch**: `main`
3. Add Environment Variables:
   - `NEXT_PUBLIC_VIDLEO_API_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Click **Deploy**.

### Step 2: Railway Infrastructure & Backend Deployment
1. Log into Railway and create a new project linked to GitHub repository `kaveri17-D/Vidleo_HQ_kaveri`.
2. **Provision Redis**:
   - Add service -> **Database** -> **Add Redis**.
   - Copy private `REDIS_URL`.
3. **Deploy Backend Service**:
   - Add service -> **GitHub Repo** -> `kaveri17-D/Vidleo_HQ_kaveri`.
   - Settings:
     - Root Directory: `backend`
     - Builder: `Dockerfile` (or Railway Nixpacks)
     - Start Command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
     - Healthcheck Path: `/api/health`
   - Set Environment Variables:
     - `PORT` (Provided by Railway)
     - `REDIS_URL` (Reference `${{Redis.REDIS_URL}}`)
     - `ALLOWED_ORIGINS` (Set to Vercel production domain)
     - `NEXUS_CORS_OWNER=app`
     - `NEXUS_USE_CELERY=1`
     - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET`
     - `ADMIN_SECRET_KEY`, `SIGNED_DOWNLOAD_SECRET`
   - Generate public domain (e.g. `*.up.railway.app` or custom domain).
4. **Deploy Background Worker Service**:
   - Add another service from same GitHub Repo.
   - Settings:
     - Root Directory: `backend`
     - Builder: `Dockerfile`
     - Start Command: `celery -A backend.celery_app worker --loglevel=info -Q meta,render,syndicate,maintenance_worker`
   - Set Environment Variables: same Redis, Supabase, and R2 credentials as Backend.

### Step 3: Cloudflare Edge Worker Deployment
1. Authenticate Wrangler CLI:
   ```bash
   npx wrangler login
   ```
2. Navigate to `worker/`:
   ```bash
   cd worker
   npm run build
   npx wrangler deploy
   ```
3. Set secret in Cloudflare:
   ```bash
   npx wrangler secret put SIGNED_DOWNLOAD_SECRET
   ```

---

## 6. Health Checks & Verification

- **Liveness Probe**:
  ```bash
  curl -fsS https://<backend-domain>/api/health
  ```
  Expected: HTTP 200 with JSON payload `{"status": "ok", "service": "media-extractor", ...}`
- **Deep Readiness Probe**:
  ```bash
  curl -fsS https://<backend-domain>/api/health/deep
  ```
  Expected: HTTP 200 with structured status across Database, Redis, Celery, Storage, and Binaries.
- **Prometheus Metrics**:
  ```bash
  curl -fsS https://<backend-domain>/metrics
  ```

---

## 7. Rollback Procedure

- **Frontend (Vercel)**:
  - In Vercel Project Dashboard -> **Deployments**, locate the last healthy deployment and click **Promote to Production**. Instant zero-downtime rollback.
- **Backend / Worker (Railway)**:
  - In Railway Dashboard -> Service -> **Deployments**, click the previous successful commit deployment and select **Rollback**.
- **Database (Supabase)**:
  - Restore Point-in-Time Recovery (PITR) snapshot or execute rollback SQL from `backups/`.

---

## 8. Remaining Manual Actions

1. Complete OAuth login for **Vercel** (`vercel login`) or connect the repo directly via the Vercel dashboard.
2. Complete OAuth login for **Railway** (`railway login`) or connect the repo directly via the Railway dashboard.
3. Refresh the expired Cloudflare token using `npx wrangler login` (or provide `CLOUDFLARE_API_TOKEN`).
