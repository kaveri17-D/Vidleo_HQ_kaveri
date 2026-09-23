-- NEXUS Media Engine
-- Migration: 025_enable_rls_policies.sql
-- Enables Row Level Security (RLS) on all remaining tables and defines secure access policies.
-- Safe to run multiple times.

-- =========================================================================
-- 1. Enable RLS on all remaining 18 tables
-- =========================================================================
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abuse_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_history_rollups_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_rollups_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_rollups_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_rollups_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abuse_rollups_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_overrides ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- 2. Define Idempotent Policies via PL/pgSQL
-- =========================================================================
DO $$
BEGIN
  -- -----------------------------------------------------------------------
  -- Service Role Access: Full ALL access for backend/internal queries
  -- -----------------------------------------------------------------------
  -- Table: jobs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'jobs' AND policyname = 'jobs_service_role_all') THEN
    CREATE POLICY jobs_service_role_all ON public.jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: job_events
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'job_events' AND policyname = 'job_events_service_role_all') THEN
    CREATE POLICY job_events_service_role_all ON public.job_events FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: payment_events
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_events' AND policyname = 'payment_events_service_role_all') THEN
    CREATE POLICY payment_events_service_role_all ON public.payment_events FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: subscriptions
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'subscriptions_service_role_all') THEN
    CREATE POLICY subscriptions_service_role_all ON public.subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: abuse_events
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'abuse_events' AND policyname = 'abuse_events_service_role_all') THEN
    CREATE POLICY abuse_events_service_role_all ON public.abuse_events FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: api_request_logs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_request_logs' AND policyname = 'api_request_logs_service_role_all') THEN
    CREATE POLICY api_request_logs_service_role_all ON public.api_request_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: media_history
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'media_history' AND policyname = 'media_history_service_role_all') THEN
    CREATE POLICY media_history_service_role_all ON public.media_history FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: vault_history_rollups_daily
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vault_history_rollups_daily' AND policyname = 'vault_history_rollups_daily_service_role_all') THEN
    CREATE POLICY vault_history_rollups_daily_service_role_all ON public.vault_history_rollups_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: revenue_rollups_daily
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'revenue_rollups_daily' AND policyname = 'revenue_rollups_daily_service_role_all') THEN
    CREATE POLICY revenue_rollups_daily_service_role_all ON public.revenue_rollups_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: audit_rollups_daily
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_rollups_daily' AND policyname = 'audit_rollups_daily_service_role_all') THEN
    CREATE POLICY audit_rollups_daily_service_role_all ON public.audit_rollups_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: subscription_rollups_daily
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subscription_rollups_daily' AND policyname = 'subscription_rollups_daily_service_role_all') THEN
    CREATE POLICY subscription_rollups_daily_service_role_all ON public.subscription_rollups_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: abuse_rollups_daily
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'abuse_rollups_daily' AND policyname = 'abuse_rollups_daily_service_role_all') THEN
    CREATE POLICY abuse_rollups_daily_service_role_all ON public.abuse_rollups_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: api_keys
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_keys' AND policyname = 'api_keys_service_role_all') THEN
    CREATE POLICY api_keys_service_role_all ON public.api_keys FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: api_key_usage_daily
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_key_usage_daily' AND policyname = 'api_key_usage_daily_service_role_all') THEN
    CREATE POLICY api_key_usage_daily_service_role_all ON public.api_key_usage_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: audit_logs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'audit_logs_service_role_all') THEN
    CREATE POLICY audit_logs_service_role_all ON public.audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: user_credit_grants
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_credit_grants' AND policyname = 'user_credit_grants_service_role_all') THEN
    CREATE POLICY user_credit_grants_service_role_all ON public.user_credit_grants FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: referral_events
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'referral_events' AND policyname = 'referral_events_service_role_all') THEN
    CREATE POLICY referral_events_service_role_all ON public.referral_events FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Table: api_key_overrides
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_key_overrides' AND policyname = 'api_key_overrides_service_role_all') THEN
    CREATE POLICY api_key_overrides_service_role_all ON public.api_key_overrides FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- -----------------------------------------------------------------------
  -- User Owner Access: Restricted SELECT/DELETE for Authenticated Users
  -- -----------------------------------------------------------------------
  -- Table: jobs (Select own)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'jobs' AND policyname = 'jobs_select_own') THEN
    CREATE POLICY jobs_select_own ON public.jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- Table: job_events (Select own linked to owned jobs)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'job_events' AND policyname = 'job_events_select_own') THEN
    CREATE POLICY job_events_select_own ON public.job_events FOR SELECT TO authenticated USING (
      EXISTS (
        SELECT 1 FROM public.jobs j 
        WHERE j.id = job_events.job_id AND j.user_id = auth.uid()
      )
    );
  END IF;

  -- Table: payment_events (Select own)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_events' AND policyname = 'payment_events_select_own') THEN
    CREATE POLICY payment_events_select_own ON public.payment_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- Table: subscriptions (Select own)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'subscriptions_select_own') THEN
    CREATE POLICY subscriptions_select_own ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- Table: api_request_logs (Select own)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_request_logs' AND policyname = 'api_request_logs_select_own') THEN
    CREATE POLICY api_request_logs_select_own ON public.api_request_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- Table: media_history (Select own)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'media_history' AND policyname = 'media_history_select_own') THEN
    CREATE POLICY media_history_select_own ON public.media_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- Table: media_history (Delete own)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'media_history' AND policyname = 'media_history_delete_own') THEN
    CREATE POLICY media_history_delete_own ON public.media_history FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- Table: api_keys (Select own)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_keys' AND policyname = 'api_keys_select_own') THEN
    CREATE POLICY api_keys_select_own ON public.api_keys FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- Table: api_key_usage_daily (Select own)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_key_usage_daily' AND policyname = 'api_key_usage_daily_select_own') THEN
    CREATE POLICY api_key_usage_daily_select_own ON public.api_key_usage_daily FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- Table: audit_logs (Select own)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'audit_logs_select_own') THEN
    CREATE POLICY audit_logs_select_own ON public.audit_logs FOR SELECT TO authenticated USING (auth.uid() = actor_user_id);
  END IF;

  -- Table: user_credit_grants (Select own)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_credit_grants' AND policyname = 'user_credit_grants_select_own') THEN
    CREATE POLICY select_user_credit_grants_owner ON public.user_credit_grants FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- Table: referral_events (Select own as referrer or referee)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'referral_events' AND policyname = 'referral_events_select_own') THEN
    CREATE POLICY referral_events_select_own ON public.referral_events FOR SELECT TO authenticated USING (
      auth.uid() = referrer_user_id OR auth.uid() = referred_user_id
    );
  END IF;

  -- Table: api_key_overrides (Select own)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_key_overrides' AND policyname = 'api_key_overrides_select_own') THEN
    CREATE POLICY api_key_overrides_select_own ON public.api_key_overrides FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

END
$$;
