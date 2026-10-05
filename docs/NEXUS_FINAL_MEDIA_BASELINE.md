# NEXUS — FINAL MEDIA VALIDATION BASELINE

**Date:** October 4, 2026  
**Status:** ESTABLISHED & ACTIVE  
**Git Baseline Commit:** `9aa214f70456ac54b7d6d0bc67668d559f5b1c5b`  
**Git Branch:** `master`

---

## 1. System Runtime Environment

| Component | Version / Description |
| :--- | :--- |
| **Operating System** | Linux (Ubuntu, Kernel 6.8.0-101-generic x86_64) |
| **Node.js** | `v22.14.0` (`/home/system/.local/bin/node`) |
| **Python** | `Python 3.14.4` (`/usr/bin/python3`) |
| **FFmpeg** | `8.0.1-3ubuntu2` |
| **FFprobe** | `8.0.1-3ubuntu2` |
| **yt-dlp** | `2026.08.19` (Configured with `--js-runtimes node:/home/system/.local/bin/node`) |

---

## 2. Active Services & Network Topology

| Service | Address | Status | Process / Handler |
| :--- | :--- | :--- | :--- |
| **Backend API** | `http://127.0.0.1:8000` | UP (PID daemon) | Uvicorn FastAPI (`backend.main:app`) |
| **Frontend UI** | `http://127.0.0.1:3000` | UP (PID daemon) | Next.js 14 App Router (`frontend/`) |
| **Worker Proxy** | `http://127.0.0.1:8787` | UP (PID daemon) | Cloudflare Worker Local Runner (`worker/local-runner.mjs`) |
| **Redis Cache/Queue** | `127.0.0.1:6379` (DB 0) | UP | Redis Server |

---

## 3. Entitlement & Target User Configuration

- **Target User:** `kaveridoye5@gmail.com`
- **Plan:** `premium`
- **Configured Flag:** `PREMIUM_EMAILS=kaveridoye5@gmail.com` in `backend/.env`
- **SQL Migration:** `backend/sql/028_grant_premium_kaveridoye5.sql`
- **Unlocked Capabilities:** 
  - `4k_allowed`: `true` (resolutions up to 2160p unlocked)
  - `max_quality`: `2160`
  - `download_limit_daily`: `500`
  - `audio_limit`: `320` kbps
  - `queue_priority`: `premium_consumer`

---

## 4. Protected Baseline Invariants

The following files and components remain protected and strictly preserved:
- `backend/manifest_schema.py`
- `backend/manifest_builder.py`
- `backend/strategy_engine.py`
- `backend/ticket_service.py`
- Cloudflare worker security contracts
- Core Supabase authentication & authorization barriers
