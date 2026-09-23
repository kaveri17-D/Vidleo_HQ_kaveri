create table if not exists public.api_key_overrides (
    key_id uuid primary key,
    user_id uuid,
    plan_tier_override text,
    custom_rate_limit integer,
    custom_daily_quota integer,
    custom_concurrency_limit integer,
    webhooks_enabled boolean not null default false,
    priority_lane text,
    retention_hours integer,
    notes text,
    updated_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_api_key_overrides_user_id
    on public.api_key_overrides(user_id);

create index if not exists idx_api_key_overrides_plan_tier_override
    on public.api_key_overrides(plan_tier_override);

create index if not exists idx_api_key_overrides_updated_at
    on public.api_key_overrides(updated_at desc);
