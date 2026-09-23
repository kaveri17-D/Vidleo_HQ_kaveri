-- NEXUS Media Engine
-- persistent abuse and security rollups
-- Safe to run multiple times.

create table if not exists public.abuse_rollups_daily (
  day date not null,
  event_type text not null default 'unknown',
  event_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, event_type)
);

create index if not exists idx_abuse_rollups_daily_day
  on public.abuse_rollups_daily(day desc);
