-- NEXUS Media Engine
-- Owner system foundation schema
-- Safe to run multiple times.

create extension if not exists "pgcrypto";

alter table if exists public.profiles
  add column if not exists role text default 'user',
  add column if not exists account_status text default 'active',
  add column if not exists current_order_id text,
  add column if not exists order_created_at timestamptz,
  add column if not exists current_order_plan text;

create table if not exists public.jobs (
  id text primary key,
  user_id uuid null,
  source_channel text,
  provider text,
  normalized_url text,
  requested_format_id text,
  requested_media_type text,
  queue_name text,
  priority text,
  status text not null default 'queued',
  progress_percent integer not null default 0,
  failure_code text,
  failure_reason text,
  result_asset_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_jobs_user_id on public.jobs(user_id);
create index if not exists idx_jobs_status on public.jobs(status);
create index if not exists idx_jobs_created_at on public.jobs(created_at desc);

create table if not exists public.job_events (
  id bigint generated always as identity primary key,
  job_id text not null references public.jobs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_events_job_id on public.job_events(job_id);
create index if not exists idx_job_events_created_at on public.job_events(created_at desc);

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  user_id uuid null,
  event_type text not null,
  provider text not null,
  provider_order_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_events_user_id on public.payment_events(user_id);
create index if not exists idx_payment_events_created_at on public.payment_events(created_at desc);

create table if not exists public.subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null unique,
  provider text not null,
  provider_subscription_id text,
  status text not null,
  plan_code text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_status on public.subscriptions(status);
create index if not exists idx_subscriptions_plan_code on public.subscriptions(plan_code);

create table if not exists public.abuse_events (
  id bigint generated always as identity primary key,
  user_id uuid null,
  api_key_id uuid null,
  event_type text not null,
  detail text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_abuse_events_user_id on public.abuse_events(user_id);
create index if not exists idx_abuse_events_created_at on public.abuse_events(created_at desc);

create table if not exists public.api_request_logs (
  id bigint generated always as identity primary key,
  api_key_id uuid null,
  user_id uuid null,
  endpoint text,
  provider text,
  response_code integer,
  last_ip text,
  processing_ms integer,
  queue_wait_ms integer,
  bytes_out bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_request_logs_user_id on public.api_request_logs(user_id);
create index if not exists idx_api_request_logs_api_key_id on public.api_request_logs(api_key_id);
create index if not exists idx_api_request_logs_created_at on public.api_request_logs(created_at desc);

create or replace function public.nexus_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_jobs_updated_at on public.jobs;
create trigger trg_jobs_updated_at
before update on public.jobs
for each row
execute function public.nexus_set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row
execute function public.nexus_set_updated_at();
