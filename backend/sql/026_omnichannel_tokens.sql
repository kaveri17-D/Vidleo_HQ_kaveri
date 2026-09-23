-- Save as: backend/sql/026_omnichannel_tokens.sql
-- Run via Supabase SQL editor or MCP tool
CREATE TABLE IF NOT EXISTS public.user_social_accounts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    platform                VARCHAR(50) NOT NULL,
    platform_user_id        VARCHAR(255),
    platform_username       VARCHAR(255),
    encrypted_access_token  BYTEA,
    encrypted_refresh_token BYTEA,
    expires_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_platform UNIQUE (user_id, platform)
);

-- Index for fast account lookups
CREATE INDEX IF NOT EXISTS idx_user_social_accounts_user_platform
    ON public.user_social_accounts (user_id, platform);

-- Enable RLS
ALTER TABLE public.user_social_accounts ENABLE ROW LEVEL SECURITY;

-- Service Role Policy (Full access for internal backend calls)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_social_accounts' AND policyname = 'user_social_accounts_service_role_all') THEN
    CREATE POLICY user_social_accounts_service_role_all ON public.user_social_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- User Access Policy (Authenticated users can select/delete their own tokens)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_social_accounts' AND policyname = 'user_social_accounts_select_own') THEN
    CREATE POLICY user_social_accounts_select_own ON public.user_social_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_social_accounts' AND policyname = 'user_social_accounts_delete_own') THEN
    CREATE POLICY user_social_accounts_delete_own ON public.user_social_accounts FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
  
  -- Authenticated user insert/update
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_social_accounts' AND policyname = 'user_social_accounts_insert_own') THEN
    CREATE POLICY user_social_accounts_insert_own ON public.user_social_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_social_accounts' AND policyname = 'user_social_accounts_update_own') THEN
    CREATE POLICY user_social_accounts_update_own ON public.user_social_accounts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

-- Cryptographic helper functions
CREATE OR REPLACE FUNCTION encrypt_social_credential(raw_token TEXT, secret_key TEXT) 
RETURNS BYTEA SECURITY DEFINER AS $$
BEGIN
    IF raw_token IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN pgp_sym_encrypt(raw_token, secret_key);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrypt_social_credential(encrypted_bytes BYTEA, secret_key TEXT) 
RETURNS TEXT SECURITY DEFINER AS $$
BEGIN
    IF encrypted_bytes IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN pgp_sym_decrypt(encrypted_bytes, secret_key);
END;
$$ LANGUAGE plpgsql;

-- RPC helper function to select and decrypt tokens
CREATE OR REPLACE FUNCTION get_decrypted_social_account(
    target_user_id UUID,
    target_platform TEXT,
    secret_key TEXT
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    platform TEXT,
    platform_user_id TEXT,
    platform_username TEXT,
    decrypted_access_token TEXT,
    decrypted_refresh_token TEXT,
    expires_at TIMESTAMPTZ
)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        usa.id,
        usa.user_id,
        usa.platform::TEXT,
        usa.platform_user_id::TEXT,
        usa.platform_username::TEXT,
        decrypt_social_credential(usa.encrypted_access_token, secret_key) AS decrypted_access_token,
        decrypt_social_credential(usa.encrypted_refresh_token, secret_key) AS decrypted_refresh_token,
        usa.expires_at
    FROM 
        public.user_social_accounts usa
    WHERE 
        usa.user_id = target_user_id 
        AND usa.platform = target_platform;
END;
$$;

-- RPC helper function to upsert encrypted tokens
CREATE OR REPLACE FUNCTION save_user_social_account(
    target_user_id UUID,
    target_platform TEXT,
    target_platform_user_id TEXT,
    target_platform_username TEXT,
    raw_access_token TEXT,
    raw_refresh_token TEXT,
    target_expires_at TIMESTAMPTZ,
    secret_key TEXT
)
RETURNS VOID
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public.user_social_accounts (
        user_id,
        platform,
        platform_user_id,
        platform_username,
        encrypted_access_token,
        encrypted_refresh_token,
        expires_at
    )
    VALUES (
        target_user_id,
        target_platform,
        target_platform_user_id,
        target_platform_username,
        encrypt_social_credential(raw_access_token, secret_key),
        encrypt_social_credential(raw_refresh_token, secret_key),
        target_expires_at
    )
    ON CONFLICT (user_id, platform) DO UPDATE
    SET
        platform_user_id = EXCLUDED.platform_user_id,
        platform_username = EXCLUDED.platform_username,
        encrypted_access_token = EXCLUDED.encrypted_access_token,
        encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW();
END;
$$;
