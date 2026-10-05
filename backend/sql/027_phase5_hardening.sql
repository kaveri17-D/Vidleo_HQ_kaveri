-- NEXUS Phase 5 — Backend Hardening Migration
-- Safe to run multiple times (idempotent).
-- DO NOT DROP any existing columns or tables.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Extend public.jobs with Phase 5 columns
-- ────────────────────────────────────────────────────────────────────────────

-- Transactional Outbox columns
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS outbox_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS outbox_dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS outbox_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outbox_last_error text,
  ADD COLUMN IF NOT EXISTS outbox_next_attempt_at timestamptz;

-- Idempotency key (sha256 of user_id|normalized_url|format_id)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Celery task ID (for revocation on cancel)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS celery_task_id text;

-- Artifact TTL: when this job's local file artifact expires
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Validation query (run after applying to verify columns exist):
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'jobs'
--   AND column_name IN (
--     'outbox_status','outbox_dispatched_at','outbox_attempt_count',
--     'outbox_last_error','outbox_next_attempt_at',
--     'idempotency_key','celery_task_id','expires_at'
--   );
-- Expected: 8 rows.

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Outbox sweeper index
-- ────────────────────────────────────────────────────────────────────────────
-- Covers: sweeper query for un-dispatched jobs
CREATE INDEX IF NOT EXISTS idx_jobs_outbox_pending
  ON public.jobs (outbox_status, outbox_next_attempt_at)
  WHERE outbox_status = 'pending';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Active-job deduplication index
-- ────────────────────────────────────────────────────────────────────────────
-- Partial unique index on idempotency_key for non-terminal active jobs.
-- NOTE: idempotency_key is nullable so NULLs are excluded automatically
-- (PostgreSQL does not enforce uniqueness on NULLs).
-- Before applying: verify no active jobs share the same idempotency_key.
-- Query: SELECT idempotency_key, count(*) FROM public.jobs
--        WHERE idempotency_key IS NOT NULL
--          AND status IN ('queued','extracting','downloading','processing')
--        GROUP BY idempotency_key HAVING count(*) > 1;
-- Expected: 0 rows before creating the index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_dedupe
  ON public.jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND status IN ('queued', 'extracting', 'downloading', 'processing');

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Expiry index (for artifact TTL queries)
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jobs_expires_at
  ON public.jobs (expires_at)
  WHERE expires_at IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Back-fill existing completed jobs with outbox_status='dispatched'
-- (They were already dispatched — no sweeping needed for them)
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.jobs
  SET outbox_status = 'dispatched'
  WHERE outbox_status = 'pending'
    AND status IN ('completed', 'failed', 'cancelled');

-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK STRATEGY (manual, if needed):
--   ALTER TABLE public.jobs
--     DROP COLUMN IF EXISTS outbox_status,
--     DROP COLUMN IF EXISTS outbox_dispatched_at,
--     DROP COLUMN IF EXISTS outbox_attempt_count,
--     DROP COLUMN IF EXISTS outbox_last_error,
--     DROP COLUMN IF EXISTS outbox_next_attempt_at,
--     DROP COLUMN IF EXISTS idempotency_key,
--     DROP COLUMN IF EXISTS celery_task_id,
--     DROP COLUMN IF EXISTS expires_at;
--   DROP INDEX IF EXISTS idx_jobs_outbox_pending;
--   DROP INDEX IF EXISTS idx_jobs_active_dedupe;
--   DROP INDEX IF EXISTS idx_jobs_expires_at;
-- ────────────────────────────────────────────────────────────────────────────
