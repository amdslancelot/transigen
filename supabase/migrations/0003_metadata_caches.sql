-- Cache YouTube video metadata (videos.list?part=snippet,contentDetails)
create table if not exists public.youtube_video_cache (
  video_id text primary key,
  title text,
  channel_title text,
  channel_id text,
  duration_sec integer,
  description text,
  thumbnails jsonb,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_youtube_video_cache_fetched
  on public.youtube_video_cache(fetched_at);

alter table public.youtube_video_cache enable row level security;

create policy "auth can read youtube cache" on public.youtube_video_cache
  for select using (auth.role() = 'authenticated');
create policy "auth can write youtube cache" on public.youtube_video_cache
  for insert with check (auth.role() = 'authenticated');
create policy "auth can update youtube cache" on public.youtube_video_cache
  for update using (auth.role() = 'authenticated');

-- Cache Spotify track metadata + audio features (search + audio-features)
create table if not exists public.spotify_track_cache (
  spotify_track_id text primary key,
  name text,
  artists text,
  album text,
  duration_ms integer,
  bpm numeric(6,2),
  time_signature integer,
  song_key integer,
  mode integer,
  energy numeric(5,4),
  danceability numeric(5,4),
  raw jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_spotify_track_cache_fetched
  on public.spotify_track_cache(fetched_at);

alter table public.spotify_track_cache enable row level security;

create policy "auth can read spotify track cache" on public.spotify_track_cache
  for select using (auth.role() = 'authenticated');
create policy "auth can write spotify track cache" on public.spotify_track_cache
  for insert with check (auth.role() = 'authenticated');
create policy "auth can update spotify track cache" on public.spotify_track_cache
  for update using (auth.role() = 'authenticated');

-- Map a YouTube video to the resolved Spotify track (so we don't repeat search/sanitize)
create table if not exists public.youtube_spotify_link (
  video_id text primary key references public.youtube_video_cache(video_id) on delete cascade,
  spotify_track_id text references public.spotify_track_cache(spotify_track_id) on delete set null,
  match_query text,
  match_status text not null default 'matched',
  fetched_at timestamptz not null default now()
);

alter table public.youtube_spotify_link enable row level security;

create policy "auth can read yt-spotify link" on public.youtube_spotify_link
  for select using (auth.role() = 'authenticated');
create policy "auth can write yt-spotify link" on public.youtube_spotify_link
  for insert with check (auth.role() = 'authenticated');
create policy "auth can update yt-spotify link" on public.youtube_spotify_link
  for update using (auth.role() = 'authenticated');
