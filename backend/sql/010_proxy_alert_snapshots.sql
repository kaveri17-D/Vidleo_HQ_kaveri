-- NEXUS Media Engine
-- Persistent proxy alert snapshots
-- Safe to run multiple times.

create table if not exists public.proxy_alert_snapshots_daily (
  id uuid default gen_random_uuid() primary key,
  snapshot_date date not null default current_date,
  provider_name text not null,
  total_probes_7d integer default 0,
  success_rate_pct_7d numeric(7, 2) default 0,
  burn_rate_per_1k_7d numeric(10, 2) default 0,
  cost_per_success_usd_7d numeric(10, 4) default 0,
  success_rate_pct_30d numeric(7, 2) default 0,
  burn_rate_per_1k_30d numeric(10, 2) default 0,
  cost_per_success_usd_30d numeric(10, 4) default 0,
  alert_count integer default 0,
  low_success_rate boolean default false,
  high_burn_rate boolean default false,
  high_cost_per_success boolean default false,
  success_rate_drop boolean default false,
  burn_rate_increase boolean default false,
  cost_increase boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(snapshot_date, provider_name)
);

create index if not exists idx_proxy_alert_snapshots_daily_date
  on public.proxy_alert_snapshots_daily(snapshot_date desc);

create index if not exists idx_proxy_alert_snapshots_daily_provider
  on public.proxy_alert_snapshots_daily(provider_name);

alter table public.proxy_alert_snapshots_daily enable row level security;

-- Only the backend service role should read/write this table.
-- Do not create public policies for proxy_alert_snapshots_daily.
