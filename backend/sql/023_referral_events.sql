create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  status text not null default 'active',
  referral_code text not null,
  referrer_user_id uuid,
  referred_user_id uuid,
  reward_download_credits integer not null default 0,
  reward_api_credits integer not null default 0,
  detail text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_referral_events_code on public.referral_events(referral_code);
create index if not exists idx_referral_events_event_type on public.referral_events(event_type);
create index if not exists idx_referral_events_referrer on public.referral_events(referrer_user_id);
create index if not exists idx_referral_events_referred on public.referral_events(referred_user_id);
create index if not exists idx_referral_events_created_at on public.referral_events(created_at desc);
