-- NEXUS Media Engine
-- persistent vault history rollups
-- Safe to run multiple times.

create table if not exists public.vault_history_rollups_daily (
  day date not null,
  delivery_mode text not null default 'unknown',
  platform text not null default 'unknown',
  format_type text not null default 'unknown',
  entry_count integer not null default 0,
  fallback_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, delivery_mode, platform, format_type)
);

create index if not exists idx_vault_history_rollups_daily_day
  on public.vault_history_rollups_daily(day desc);
