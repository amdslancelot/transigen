-- Room popularity + directory search (by song titles in start/set + youtube cache).

alter table public.rooms
  add column if not exists play_count integer not null default 0;

create index if not exists idx_rooms_play_count_created
  on public.rooms (play_count desc, created_at desc);

-- Any signed-in user can bump play count (SECURITY DEFINER; RLS would block generic updates).
create or replace function public.increment_room_play_count(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rooms
  set play_count = play_count + 1
  where id = p_room_id;
end;
$$;

revoke all on function public.increment_room_play_count(uuid) from public;
grant execute on function public.increment_room_play_count(uuid) to authenticated;

-- Escape user text for ILIKE (wrap with % outside).
create or replace function public.escape_ilike_fragment(p_text text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(coalesce(p_text, ''), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
$$;

revoke all on function public.escape_ilike_fragment(text) from public;
grant execute on function public.escape_ilike_fragment(text) to authenticated;

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
security invoker
set search_path = public
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

revoke all on function public.list_rooms_directory(text, int, int) from public;
grant execute on function public.list_rooms_directory(text, int, int) to authenticated;

create or replace function public.count_rooms_directory(search_q text)
returns bigint
language sql
stable
security invoker
set search_path = public
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

revoke all on function public.count_rooms_directory(text) from public;
grant execute on function public.count_rooms_directory(text) to authenticated;
