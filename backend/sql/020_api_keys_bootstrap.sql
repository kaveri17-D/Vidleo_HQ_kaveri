-- NEXUS api_keys bootstrap
-- Safe to run multiple times.

create extension if not exists "pgcrypto";

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Production Key',
  key_prefix text not null,
  key_hash text not null unique,
  status text not null default 'active',
  plan_tier text not null default 'api',
  scopes jsonb not null default '[]'::jsonb,
  rate_limit integer not null default 120,
  last_used_at timestamptz,
  last_ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_api_keys_user_id on public.api_keys(user_id);
create index if not exists idx_api_keys_status on public.api_keys(status);
create index if not exists idx_api_keys_created_at on public.api_keys(created_at desc);

create or replace function public.nexus_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_api_keys_updated_at on public.api_keys;
create trigger trg_api_keys_updated_at
before update on public.api_keys
for each row
execute function public.nexus_set_updated_at();
