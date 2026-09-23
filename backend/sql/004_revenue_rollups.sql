-- NEXUS Media Engine
-- persistent revenue rollups
-- Safe to run multiple times.

create table if not exists public.revenue_rollups_daily (
  day date not null,
  event_type text not null default 'unknown',
  plan_code text not null default 'unknown',
  event_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, event_type, plan_code)
);

create index if not exists idx_revenue_rollups_daily_day
  on public.revenue_rollups_daily(day desc);
