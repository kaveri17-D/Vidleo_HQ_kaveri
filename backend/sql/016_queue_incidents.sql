-- NEXUS Media Engine
-- low-frequency execution-plane incident telemetry
-- Safe to run multiple times.

create table if not exists public.queue_incidents (
  id bigint generated always as identity primary key,
  provider text not null default 'celery',
  incident_type text not null default 'unknown',
  queue_name text not null default 'unknown',
  job_id text,
  runner text,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_queue_incidents_created_at
  on public.queue_incidents(created_at desc);

create index if not exists idx_queue_incidents_incident_type
  on public.queue_incidents(incident_type);

create index if not exists idx_queue_incidents_queue_name
  on public.queue_incidents(queue_name);

alter table public.queue_incidents enable row level security;
