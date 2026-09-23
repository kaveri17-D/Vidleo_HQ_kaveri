-- NEXUS Media Engine
-- Persistent proxy circuit breaker alert history
-- Safe to run multiple times.

create extension if not exists "pgcrypto";

create table if not exists public.proxy_alert_history (
  id uuid default gen_random_uuid() primary key,
  alert_type text not null default 'unknown',
  provider_name text not null default 'unknown',
  total_probes integer not null default 0,
  success_rate_pct numeric(6, 2) not null default 0.00,
  burn_rate_per_1k numeric(10, 2) not null default 0.00,
  reason_text text,
  created_at timestamptz not null default now()
);

create index if not exists idx_proxy_alert_history_created_at
  on public.proxy_alert_history(created_at desc);

create index if not exists idx_proxy_alert_history_provider_name
  on public.proxy_alert_history(provider_name);

create index if not exists idx_proxy_alert_history_alert_type
  on public.proxy_alert_history(alert_type);

alter table public.proxy_alert_history enable row level security;
