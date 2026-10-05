-- ==============================================================================
-- NEXUS Media Engine — Migration 028
-- Seed / Grant Full Premium Entitlement to kaveridoye5@gmail.com
-- Safe to run multiple times (idempotent).
-- ==============================================================================

-- 1. Update public.profiles if existing profile exists
UPDATE public.profiles
SET 
  plan = 'premium',
  account_status = 'active',
  updated_at = now()
WHERE lower(email) = 'kaveridoye5@gmail.com';

-- 2. Upsert active premium subscription in public.subscriptions
INSERT INTO public.subscriptions (
  user_id,
  provider,
  provider_subscription_id,
  status,
  plan_code,
  current_period_end,
  cancel_at_period_end,
  created_at,
  updated_at
)
SELECT 
  id,
  'admin_grant',
  'grant:kaveridoye5@gmail.com',
  'active',
  'premium',
  now() + interval '10 years',
  false,
  now(),
  now()
FROM auth.users
WHERE lower(email) = 'kaveridoye5@gmail.com'
ON CONFLICT (user_id) DO UPDATE
SET 
  plan_code = 'premium',
  status = 'active',
  current_period_end = now() + interval '10 years',
  cancel_at_period_end = false,
  updated_at = now();
