-- NEXUS Media Engine
-- Low-frequency billing incident telemetry
-- Safe to run multiple times.

create extension if not exists "pgcrypto";

create table if not exists public.billing_incidents (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  incident_type text not null,
  event_type text,
  provider_reference text,
  detail text,
  status_code integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_incidents_created_at
  on public.billing_incidents(created_at desc);

create index if not exists idx_billing_incidents_provider
  on public.billing_incidents(provider);

create index if not exists idx_billing_incidents_incident_type
  on public.billing_incidents(incident_type);

alter table public.billing_incidents enable row level security;
