-- Sub-second trim points on transition proposals (YouTube seek uses fractional seconds).

alter table public.transition_proposals
  alter column end_prev_sec type numeric(14, 4) using end_prev_sec::numeric,
  alter column start_next_sec type numeric(14, 4) using start_next_sec::numeric;
