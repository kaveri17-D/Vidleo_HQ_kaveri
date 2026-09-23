-- NEXUS Media Engine
-- Bootstrap the public.profiles table expected by billing, auth, and owner tooling.
-- Safe to run multiple times.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'free',
  role text not null default 'user',
  account_status text not null default 'active',
  current_order_id text,
  order_created_at timestamptz,
  current_order_plan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_plan on public.profiles(plan);
create index if not exists idx_profiles_role on public.profiles(role);

create or replace function public.handle_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.handle_profile_updated_at();

insert into public.profiles (id, email)
select u.id, u.email
from auth.users u
on conflict (id) do update
set email = excluded.email;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
  set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'profiles'
      and schemaname = 'public'
      and policyname = 'profiles_select_own'
  ) then
    execute $policy$
      create policy profiles_select_own
        on public.profiles
        for select
        to authenticated
        using (auth.uid() = id);
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'profiles'
      and schemaname = 'public'
      and policyname = 'profiles_update_own'
  ) then
    execute $policy$
      create policy profiles_update_own
        on public.profiles
        for update
        to authenticated
        using (auth.uid() = id)
        with check (auth.uid() = id);
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'profiles'
      and schemaname = 'public'
      and policyname = 'profiles_insert_service_role'
  ) then
    execute $policy$
      create policy profiles_insert_service_role
        on public.profiles
        for all
        to service_role
        using (true)
        with check (true);
    $policy$;
  end if;
end
$$;
