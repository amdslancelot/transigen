-- Consolidated baseline for plain PostgreSQL.
-- Replaces supabase/migrations 0001-0007: Supabase auth.users is replaced by
-- public.users (provisioned via Google OAuth), row-level security is removed
-- (all access goes through the server with a single application role), and an
-- ingest_jobs NOTIFY trigger replaces Supabase Realtime.

create extension if not exists "pgcrypto";

-- Application users, provisioned on first Google sign-in.
create table if not exists public.users (
  id          uuid        primary key default gen_random_uuid(),
  google_sub  text        not null unique,
  email       text        not null,
  name        text,
  image       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_users_updated_at
  before update on public.users
  for each row execute procedure public.handle_updated_at();

-- Transition presets are label-only for the YouTube MVP.
create table if not exists public.transition_presets (
  id          uuid        primary key default gen_random_uuid(),
  code        text        not null unique,
  label       text        not null,
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists public.transition_pairs (
  id         uuid        primary key default gen_random_uuid(),
  from_media jsonb       not null,
  to_media   jsonb       not null,
  created_by uuid        not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Uniqueness over the JSONB media identity (provider + videoId on both sides).
create unique index if not exists idx_transition_pairs_unique_media
on public.transition_pairs (
  (from_media->>'provider'),
  (from_media->>'videoId'),
  (to_media->>'provider'),
  (to_media->>'videoId')
);

create table if not exists public.transition_proposals (
  id             uuid           primary key default gen_random_uuid(),
  pair_id        uuid           not null references public.transition_pairs(id) on delete cascade,
  proposed_by    uuid           not null references public.users(id) on delete cascade,
  end_prev_sec   numeric(14,4),
  start_next_sec numeric(14,4),
  preset_id      uuid           references public.transition_presets(id) on delete set null,
  note           text,
  prev_bpm       numeric(6,2),
  params         jsonb          not null default '{}'::jsonb,
  created_at     timestamptz    not null default now(),
  check (end_prev_sec is null or end_prev_sec >= 0),
  check (start_next_sec is null or start_next_sec >= 0),
  constraint transition_proposals_bpm_range
    check (prev_bpm is null or (prev_bpm > 0 and prev_bpm <= 300))
);

create unique index if not exists uq_transition_proposals_author_full
on public.transition_proposals (pair_id, proposed_by, end_prev_sec, start_next_sec, preset_id)
where end_prev_sec is not null
  and start_next_sec is not null
  and preset_id is not null;

create table if not exists public.transition_votes (
  proposal_id uuid        not null references public.transition_proposals(id) on delete cascade,
  user_id     uuid        not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

create table if not exists public.rooms (
  id          uuid        primary key default gen_random_uuid(),
  owner_id    uuid        not null references public.users(id) on delete cascade,
  title       text        not null,
  slug        text        not null unique,
  start_media jsonb       not null,
  play_count  integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_rooms_play_count_created
  on public.rooms (play_count desc, created_at desc);

create table if not exists public.room_members (
  room_id   uuid        not null references public.rooms(id) on delete cascade,
  user_id   uuid        not null references public.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.room_set_items (
  id                            uuid        primary key default gen_random_uuid(),
  room_id                       uuid        not null references public.rooms(id) on delete cascade,
  position                      integer     not null,
  media                         jsonb       not null,
  transition_pair_id_from_prev  uuid        references public.transition_pairs(id) on delete set null,
  best_proposal_id_from_prev    uuid        references public.transition_proposals(id) on delete set null,
  created_at                    timestamptz not null default now(),
  unique (room_id, position)
);

create index if not exists idx_transition_proposals_pair on public.transition_proposals(pair_id);
create index if not exists idx_room_set_items_room on public.room_set_items(room_id, position);

-- Cache YouTube video metadata (videos.list?part=snippet,contentDetails).
create table if not exists public.youtube_video_cache (
  video_id      text        primary key,
  title         text,
  channel_title text,
  channel_id    text,
  duration_sec  integer,
  description   text,
  thumbnails    jsonb,
  raw           jsonb,
  fetched_at    timestamptz not null default now()
);

create index if not exists idx_youtube_video_cache_fetched
  on public.youtube_video_cache(fetched_at);

-- Cache Spotify track metadata + audio features (search + audio-features).
create table if not exists public.spotify_track_cache (
  spotify_track_id text          primary key,
  name             text,
  artists          text,
  album            text,
  duration_ms      integer,
  bpm              numeric(6,2),
  time_signature   integer,
  song_key         integer,
  mode             integer,
  energy           numeric(5,4),
  danceability     numeric(5,4),
  raw              jsonb,
  fetched_at       timestamptz   not null default now()
);

create index if not exists idx_spotify_track_cache_fetched
  on public.spotify_track_cache(fetched_at);

-- Map a YouTube video to the resolved Spotify track (so we don't repeat search/sanitize).
create table if not exists public.youtube_spotify_link (
  video_id         text        primary key references public.youtube_video_cache(video_id) on delete cascade,
  spotify_track_id text        references public.spotify_track_cache(spotify_track_id) on delete set null,
  match_query      text,
  match_status     text        not null default 'matched',
  fetched_at       timestamptz not null default now()
);

-- Ingest job queue: tracks background BPM/beat analysis jobs per video.
create table if not exists public.ingest_jobs (
  id            uuid        primary key default gen_random_uuid(),
  video_id      text        not null unique,
  status        text        not null default 'pending'
                            check (status in ('pending', 'processing', 'done', 'failed')),
  error_message text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_ingest_jobs_status
  on public.ingest_jobs(status);

create trigger trg_ingest_jobs_updated_at
  before update on public.ingest_jobs
  for each row execute procedure public.handle_updated_at();

-- Replaces Supabase Realtime: every insert/update on ingest_jobs emits a
-- NOTIFY consumed by the app's SSE route (LISTEN ingest_jobs_changed).
create or replace function public.notify_ingest_job_change()
returns trigger language plpgsql as $$
begin
  perform pg_notify(
    'ingest_jobs_changed',
    json_build_object(
      'video_id', new.video_id,
      'status', new.status,
      'error_message', new.error_message
    )::text
  );
  return new;
end;
$$;

create trigger trg_ingest_jobs_notify
  after insert or update on public.ingest_jobs
  for each row execute procedure public.notify_ingest_job_change();

-- Track analysis results: BPM, beat grid, duration per video.
create table if not exists public.track_analysis (
  video_id    text        primary key,
  bpm         float4      not null,
  beat_offset float4      not null,  -- seconds from track start to first beat
  beats       jsonb,                 -- array of beat timestamps in seconds
  duration    float4      not null,
  created_at  timestamptz not null default now()
);

create or replace function public.top_transition_proposal_for_pair(p_pair_id uuid)
returns table (id uuid, votes bigint)
language sql
stable
as $$
  select tp.id, count(tv.user_id)::bigint as votes
  from public.transition_proposals tp
  left join public.transition_votes tv on tv.proposal_id = tp.id
  where tp.pair_id = p_pair_id
  group by tp.id, tp.created_at
  order by votes desc, tp.created_at asc
  limit 1;
$$;

create or replace function public.increment_room_play_count(p_room_id uuid)
returns void
language plpgsql
as $$
begin
  update public.rooms
  set play_count = play_count + 1
  where id = p_room_id;
end;
$$;

-- Escape user text for ILIKE (wrap with % outside).
create or replace function public.escape_ilike_fragment(p_text text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(coalesce(p_text, ''), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
$$;

create or replace function public.list_rooms_directory(
  search_q text,
  result_limit int,
  result_offset int
)
returns table (
  id uuid,
  owner_id uuid,
  title text,
  slug text,
  start_media jsonb,
  created_at timestamptz,
  play_count integer
)
language sql
stable
as $$
  with needle as (
    select trim(coalesce(search_q, '')) as raw
  ),
  pat as (
    select
      case
        when (select raw from needle) = '' then null::text
        else '%' || public.escape_ilike_fragment((select raw from needle)) || '%'
      end as like_pat
  ),
  matched as (
    select distinct r2.id
    from public.rooms r2
    left join public.room_set_items rsi on rsi.room_id = r2.id
    left join public.youtube_video_cache y1 on y1.video_id = (r2.start_media->>'videoId')
    left join public.youtube_video_cache y2 on y2.video_id = (rsi.media->>'videoId')
    cross join pat
    where
      pat.like_pat is null
      or coalesce(y1.title, '') ilike pat.like_pat escape '\'
      or coalesce(y2.title, '') ilike pat.like_pat escape '\'
      or coalesce(r2.start_media->>'title', '') ilike pat.like_pat escape '\'
      or coalesce(rsi.media->>'title', '') ilike pat.like_pat escape '\'
  )
  select r.id, r.owner_id, r.title, r.slug, r.start_media, r.created_at, r.play_count
  from public.rooms r
  join matched m on m.id = r.id
  order by r.play_count desc, r.created_at desc
  limit greatest(coalesce(result_limit, 10), 1)
  offset greatest(coalesce(result_offset, 0), 0);
$$;

create or replace function public.count_rooms_directory(search_q text)
returns bigint
language sql
stable
as $$
  with needle as (
    select trim(coalesce(search_q, '')) as raw
  ),
  pat as (
    select
      case
        when (select raw from needle) = '' then null::text
        else '%' || public.escape_ilike_fragment((select raw from needle)) || '%'
      end as like_pat
  ),
  matched as (
    select distinct r2.id
    from public.rooms r2
    left join public.room_set_items rsi on rsi.room_id = r2.id
    left join public.youtube_video_cache y1 on y1.video_id = (r2.start_media->>'videoId')
    left join public.youtube_video_cache y2 on y2.video_id = (rsi.media->>'videoId')
    cross join pat
    where
      pat.like_pat is null
      or coalesce(y1.title, '') ilike pat.like_pat escape '\'
      or coalesce(y2.title, '') ilike pat.like_pat escape '\'
      or coalesce(r2.start_media->>'title', '') ilike pat.like_pat escape '\'
      or coalesce(rsi.media->>'title', '') ilike pat.like_pat escape '\'
  )
  select count(*)::bigint from matched;
$$;

-- Seed data: final preset set (post 0002/0004/0005 renames).
insert into public.transition_presets (code, label, description)
values
  ('hard_cut', 'Hard Cut', 'Instant switch from A to B at chosen timestamps'),
  ('fade', 'Fade', 'Crossfade from Song A into Song B at chosen timestamps (B continues after the handoff).'),
  ('echo_16', 'echo 16', '16 half-beat rebounds with fade-out (same step as stutter; longer than echo 8).'),
  ('echo_8', 'echo 8', '8 half-beat rebounds with fade-out (same step as stutter 8; replaces former echo 4 length).'),
  ('stutter_8', 'stutter 8', '8 half-beat rebounds, constant volume'),
  ('stutter_4', 'stutter 4', '4 half-beat rebounds, constant volume')
on conflict (code) do update set label = excluded.label, description = excluded.description;
