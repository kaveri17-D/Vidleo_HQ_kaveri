-- NEXUS Media Engine
-- persistent proxy circuit-breaker history rollups
-- Safe to run multiple times.

create table if not exists public.proxy_alert_rollups_daily (
  day date not null,
  alert_type text not null default 'unknown',
  provider_name text not null default 'unknown',
  event_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, alert_type, provider_name)
);

create index if not exists idx_proxy_alert_rollups_daily_day
  on public.proxy_alert_rollups_daily(day desc);

create index if not exists idx_proxy_alert_rollups_daily_provider
  on public.proxy_alert_rollups_daily(provider_name);

alter table public.proxy_alert_rollups_daily enable row level security;
