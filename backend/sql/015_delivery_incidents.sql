-- NEXUS Media Engine
-- low-frequency delivery incident telemetry
-- Safe to run multiple times.

create table if not exists public.delivery_incidents (
  id bigint generated always as identity primary key,
  provider text not null default 'unknown',
  incident_type text not null default 'unknown',
  artifact_mode text not null default 'unknown',
  job_id text,
  filename text,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_delivery_incidents_created_at
  on public.delivery_incidents(created_at desc);

create index if not exists idx_delivery_incidents_provider
  on public.delivery_incidents(provider);

create index if not exists idx_delivery_incidents_incident_type
  on public.delivery_incidents(incident_type);

alter table public.delivery_incidents enable row level security;
