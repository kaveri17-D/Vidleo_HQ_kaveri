-- NEXUS API usage daily rollups + audit logs bootstrap
-- Safe to run multiple times.

create table if not exists public.api_key_usage_daily (
  id bigint generated always as identity primary key,
  api_key_id uuid null references public.api_keys(id) on delete cascade,
  user_id uuid null references public.profiles(id) on delete cascade,
  day date not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (api_key_id, day)
);

create index if not exists idx_api_key_usage_daily_api_key_id on public.api_key_usage_daily(api_key_id);
create index if not exists idx_api_key_usage_daily_user_id on public.api_key_usage_daily(user_id);
create index if not exists idx_api_key_usage_daily_day on public.api_key_usage_daily(day desc);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid null references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  detail text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_actor_user_id on public.audit_logs(actor_user_id);
create index if not exists idx_audit_logs_action on public.audit_logs(action);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);
