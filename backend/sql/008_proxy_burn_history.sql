-- NEXUS Media Engine
-- Persistent proxy burn and operator history
-- Safe to run multiple times.

create table if not exists public.proxy_burn_events (
  id bigint generated always as identity primary key,
  event_type text not null default 'unknown',
  provider text not null default 'unknown',
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_proxy_burn_events_created_at
  on public.proxy_burn_events(created_at desc);

create index if not exists idx_proxy_burn_events_provider
  on public.proxy_burn_events(provider);

create index if not exists idx_proxy_burn_events_event_type
  on public.proxy_burn_events(event_type);

-- LOCK IT DOWN: SaaS Security Standard
alter table public.proxy_burn_events enable row level security;

-- Only the backend service role should read/write this table.
-- Do not create public policies for proxy_burn_events.
