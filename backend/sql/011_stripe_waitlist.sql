-- NEXUS Media Engine
-- Stripe demand capture / access requests waitlist
-- Safe to run multiple times (idempotent DDL).

create table if not exists public.stripe_access_requests (
  id            bigint generated always as identity primary key,
  user_id       uuid        not null,
  requested_plan text        not null,
  status        text        not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Anti-spam: one row per (user, plan) — upserts just bump updated_at
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_stripe_access_requests_user_plan'
      and conrelid = 'public.stripe_access_requests'::regclass
  ) then
    alter table public.stripe_access_requests
      add constraint uq_stripe_access_requests_user_plan
      unique (user_id, requested_plan);
  end if;
end
$$;

create index if not exists idx_stripe_access_requests_created_at
  on public.stripe_access_requests(created_at desc);

create index if not exists idx_stripe_access_requests_user_id
  on public.stripe_access_requests(user_id);

-- RLS: table is only accessible via service-role key (server-side).
-- No anon/authenticated client-side reads are needed.
alter table public.stripe_access_requests enable row level security;

-- Allow service-role (backend) full access; deny all other roles by default.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename  = 'stripe_access_requests'
      and schemaname = 'public'
      and policyname = 'service_role_full_access'
  ) then
    execute $policy$
      create policy service_role_full_access
        on public.stripe_access_requests
        for all
        to service_role
        using (true)
        with check (true);
    $policy$;
  end if;
end
$$;
