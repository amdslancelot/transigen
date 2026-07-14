-- Audio ingest job queue and track analysis results (Phase 1 audio analysis architecture).

-- handle_updated_at() does not exist in prior migrations; define it here.
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Ingest job queue: tracks background BPM/beat analysis jobs per video.
create table if not exists public.ingest_jobs (
  id             uuid        primary key default gen_random_uuid(),
  video_id       text        not null unique,
  status         text        not null default 'pending'
                             check (status in ('pending', 'processing', 'done', 'failed')),
  error_message  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_ingest_jobs_status
  on public.ingest_jobs(status);

create trigger trg_ingest_jobs_updated_at
  before update on public.ingest_jobs
  for each row execute procedure public.handle_updated_at();

alter table public.ingest_jobs enable row level security;

create policy "anon and auth can read ingest jobs" on public.ingest_jobs
  for select using (true);
create policy "auth can insert ingest jobs" on public.ingest_jobs
  for insert with check (auth.role() = 'authenticated');

-- Track analysis results: BPM, beat grid, duration per video.
create table if not exists public.track_analysis (
  video_id      text    primary key,
  bpm           float4  not null,
  beat_offset   float4  not null,  -- seconds from track start to first beat
  beats         jsonb,             -- array of beat timestamps in seconds
  duration      float4  not null,
  created_at    timestamptz not null default now()
);

alter table public.track_analysis enable row level security;

create policy "anon and auth can read track analysis" on public.track_analysis
  for select using (true);
-- insert/update done by service_role which bypasses RLS; no extra policy needed.

-- Realtime subscriptions for both tables (guarded: self-hosted Supabase may not have this publication).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ingest_jobs, public.track_analysis;
  end if;
end;
$$;
