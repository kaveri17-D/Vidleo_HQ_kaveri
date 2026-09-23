create table if not exists public.user_credit_grants (
  user_id uuid primary key,
  bonus_download_credits integer not null default 0,
  bonus_api_credits integer not null default 0,
  notes text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_credit_grants_updated_at
  on public.user_credit_grants(updated_at desc);
