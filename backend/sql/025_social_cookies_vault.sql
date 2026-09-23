-- Save as: backend/sql/025_social_cookies_vault.sql
-- Run via Supabase SQL editor or psql
CREATE TABLE IF NOT EXISTS public.social_cookies (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider              TEXT NOT NULL,
    username              TEXT NOT NULL,
    cookie_data           TEXT NOT NULL,            -- Netscape-format cookie file content
    status                TEXT NOT NULL DEFAULT 'active',  -- active | quarantined | retired
    consecutive_failures  INT  NOT NULL DEFAULT 0,
    quarantined_until     TIMESTAMPTZ,
    last_success_at       TIMESTAMPTZ,
    last_failure_reason   TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, username)
);

CREATE INDEX IF NOT EXISTS idx_social_cookies_provider_status
    ON public.social_cookies (provider, status, quarantined_until);
