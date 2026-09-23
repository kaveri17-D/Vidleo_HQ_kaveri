create table if not exists public.media_history (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text,
  url text,
  thumbnail text,
  platform text,
  filesize bigint,
  duration integer,
  created_at timestamptz not null default now()
);

alter table if exists public.media_history
  add column if not exists format text,
  add column if not exists format_type text,
  add column if not exists job_id text,
  add column if not exists filename text,
  add column if not exists direct_url text,
  add column if not exists fallback_url text,
  add column if not exists delivery_mode text,
  add column if not exists expires_at timestamptz;

create index if not exists idx_media_history_user_id_created_at
  on public.media_history(user_id, created_at desc);

create index if not exists idx_media_history_delivery_mode
  on public.media_history(delivery_mode);

create index if not exists idx_media_history_format_type
  on public.media_history(format_type);

create index if not exists idx_media_history_job_id
  on public.media_history(job_id);
