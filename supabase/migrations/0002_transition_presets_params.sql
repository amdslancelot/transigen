-- Replace echo_like with echo/stutter variants; add BPM + params for proposals.

delete from public.transition_presets where code = 'echo_like';

insert into public.transition_presets (code, label, description)
values
  ('echo_8', 'echo 8', '8 rebounds on the beat with fade-out into B'),
  ('echo_4', 'echo 4', '4 rebounds on the beat with fade-out into B'),
  ('stutter_8', 'stutter 8', '8 half-beat rebounds, constant volume'),
  ('stutter_4', 'stutter 4', '4 half-beat rebounds, constant volume')
on conflict (code) do update set label = excluded.label, description = excluded.description;

alter table public.transition_proposals
  add column if not exists prev_bpm numeric(6,2),
  add column if not exists params jsonb not null default '{}'::jsonb;

alter table public.transition_proposals
  drop constraint if exists transition_proposals_bpm_range;

alter table public.transition_proposals
  add constraint transition_proposals_bpm_range
  check (prev_bpm is null or (prev_bpm > 0 and prev_bpm <= 300));

create unique index if not exists uq_transition_proposals_author_full
on public.transition_proposals (pair_id, proposed_by, end_prev_sec, start_next_sec, preset_id)
where end_prev_sec is not null
  and start_next_sec is not null
  and preset_id is not null;
