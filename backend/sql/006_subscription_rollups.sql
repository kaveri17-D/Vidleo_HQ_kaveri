-- NEXUS Media Engine
-- persistent subscription rollups
-- Safe to run multiple times.

create table if not exists public.subscription_rollups_daily (
  day date not null,
  status text not null default 'unknown',
  plan_code text not null default 'unknown',
  provider text not null default 'unknown',
  subscription_count integer not null default 0,
  active_count integer not null default 0,
  expiring_soon_count integer not null default 0,
  canceling_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, status, plan_code, provider)
);

create index if not exists idx_subscription_rollups_daily_day
  on public.subscription_rollups_daily(day desc);
