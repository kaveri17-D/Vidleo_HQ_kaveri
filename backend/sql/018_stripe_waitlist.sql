-- NEXUS Media Engine
-- International Stripe demand capture for location-aware billing.

create table if not exists public.stripe_waitlist (
  id            bigint generated always as identity primary key,
  user_id       uuid        not null,
  email         text        not null,
  desired_plan  text        not null,
  country_code  text        not null default 'US',
  status        text        not null default 'pending',
  source        text        not null default 'nexus-web',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_stripe_waitlist_user_plan'
      and conrelid = 'public.stripe_waitlist'::regclass
  ) then
    alter table public.stripe_waitlist
      add constraint uq_stripe_waitlist_user_plan
      unique (user_id, desired_plan);
  end if;
end
$$;

create index if not exists idx_stripe_waitlist_created_at
  on public.stripe_waitlist(created_at desc);

create index if not exists idx_stripe_waitlist_email
  on public.stripe_waitlist(email);

alter table public.stripe_waitlist enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'stripe_waitlist'
      and schemaname = 'public'
      and policyname = 'service_role_full_access'
  ) then
    execute $policy$
      create policy service_role_full_access
        on public.stripe_waitlist
        for all
        to service_role
        using (true)
        with check (true);
    $policy$;
  end if;
end
$$;
