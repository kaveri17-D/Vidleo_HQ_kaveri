-- NEXUS Media Engine
-- persistent owner audit rollups
-- Safe to run multiple times.

create table if not exists public.audit_rollups_daily (
  day date not null,
  action text not null default 'unknown',
  target_type text not null default 'unknown',
  event_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, action, target_type)
);

create index if not exists idx_audit_rollups_daily_day
  on public.audit_rollups_daily(day desc);
