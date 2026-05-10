-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Transition presets are label-only for YouTube/Spotify MVP.
create table if not exists public.transition_presets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.transition_pairs (
  id uuid primary key default gen_random_uuid(),
  from_media jsonb not null,
  to_media jsonb not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (
    (from_media->>'provider'),
    (from_media->>'videoId'),
    (to_media->>'provider'),
    (to_media->>'videoId')
  )
);

create table if not exists public.transition_proposals (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.transition_pairs(id) on delete cascade,
  proposed_by uuid not null references auth.users(id) on delete cascade,
  end_prev_sec integer,
  start_next_sec integer,
  preset_id uuid references public.transition_presets(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  check (end_prev_sec is null or end_prev_sec >= 0),
  check (start_next_sec is null or start_next_sec >= 0)
);

create table if not exists public.transition_votes (
  proposal_id uuid not null references public.transition_proposals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  slug text not null unique,
  start_media jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.room_set_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  position integer not null,
  media jsonb not null,
  transition_pair_id_from_prev uuid references public.transition_pairs(id) on delete set null,
  best_proposal_id_from_prev uuid references public.transition_proposals(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (room_id, position)
);

create index if not exists idx_transition_proposals_pair on public.transition_proposals(pair_id);
create index if not exists idx_room_set_items_room on public.room_set_items(room_id, position);

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

insert into public.transition_presets (code, label, description)
values
  ('hard_cut', 'Hard Cut', 'Instant switch from A to B at chosen timestamps'),
  ('fade_like', 'Fade-Like', 'Timestamp cut with softer handoff intent label'),
  ('echo_like', 'Echo-Like', 'Timestamp cut with echo-style intent label')
on conflict (code) do nothing;

alter table public.transition_pairs enable row level security;
alter table public.transition_proposals enable row level security;
alter table public.transition_votes enable row level security;
alter table public.transition_presets enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_set_items enable row level security;

-- Read access for authenticated users.
create policy "auth can read presets" on public.transition_presets
  for select using (auth.role() = 'authenticated');

create policy "auth can read pairs" on public.transition_pairs
  for select using (auth.role() = 'authenticated');
create policy "auth can insert pairs" on public.transition_pairs
  for insert with check (auth.uid() = created_by);

create policy "auth can read proposals" on public.transition_proposals
  for select using (auth.role() = 'authenticated');
create policy "auth can insert proposals" on public.transition_proposals
  for insert with check (auth.uid() = proposed_by);
create policy "author can update proposal" on public.transition_proposals
  for update using (auth.uid() = proposed_by);
create policy "author can delete proposal" on public.transition_proposals
  for delete using (auth.uid() = proposed_by);

create policy "auth can read votes" on public.transition_votes
  for select using (auth.role() = 'authenticated');
create policy "auth can vote" on public.transition_votes
  for insert with check (auth.uid() = user_id);
create policy "auth can unvote own vote" on public.transition_votes
  for delete using (auth.uid() = user_id);

create policy "auth can read rooms" on public.rooms
  for select using (auth.role() = 'authenticated');
create policy "owner can insert rooms" on public.rooms
  for insert with check (auth.uid() = owner_id);
create policy "owner can update rooms" on public.rooms
  for update using (auth.uid() = owner_id);
create policy "owner can delete rooms" on public.rooms
  for delete using (auth.uid() = owner_id);

create policy "auth can read room members" on public.room_members
  for select using (auth.role() = 'authenticated');
create policy "auth can join room" on public.room_members
  for insert with check (auth.uid() = user_id);
create policy "member can leave room" on public.room_members
  for delete using (auth.uid() = user_id);

create policy "auth can read room set items" on public.room_set_items
  for select using (auth.role() = 'authenticated');
create policy "room members can insert set items" on public.room_set_items
  for insert with check (
    exists (
      select 1 from public.room_members rm
      where rm.room_id = room_set_items.room_id and rm.user_id = auth.uid()
    )
  );
create policy "room members can update set items" on public.room_set_items
  for update using (
    exists (
      select 1 from public.room_members rm
      where rm.room_id = room_set_items.room_id and rm.user_id = auth.uid()
    )
  );
create policy "room members can delete set items" on public.room_set_items
  for delete using (
    exists (
      select 1 from public.room_members rm
      where rm.room_id = room_set_items.room_id and rm.user_id = auth.uid()
    )
  );
