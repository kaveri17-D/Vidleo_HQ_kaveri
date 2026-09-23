-- NEXUS Media Engine
-- persistent proxy breaker posture daily rollups
-- Safe to run multiple times.

create table if not exists public.proxy_breaker_posture_rollups_daily (
  day date primary key,
  total_recurring_offenders integer not null default 0,
  total_quarantined integer not null default 0,
  normal_providers integer not null default 0,
  elevated_providers integer not null default 0,
  severe_providers integer not null default 0,
  quarantined_providers integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_proxy_breaker_posture_rollups_daily_day
  on public.proxy_breaker_posture_rollups_daily(day desc);

alter table public.proxy_breaker_posture_rollups_daily enable row level security;
