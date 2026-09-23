-- NEXUS backend RLS/grant repair
-- Run this in the Supabase SQL Editor only if permission errors remain
-- after configuring SUPABASE_SERVICE_KEY in backend/.env.

grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
grant all privileges on tables to service_role;

alter default privileges in schema public
grant usage, select on sequences to service_role;

alter default privileges in schema public
grant execute on functions to service_role;

alter table if exists public.profiles enable row level security;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'profiles'
  ) then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'profiles'
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
      where schemaname = 'public'
        and tablename = 'profiles'
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
      where schemaname = 'public'
        and tablename = 'profiles'
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
  end if;
end
$$;
