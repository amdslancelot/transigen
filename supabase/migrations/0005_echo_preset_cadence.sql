-- Echo presets: same half-beat cadence as stutter, with longer windows (echo_8 / echo_16).
-- Rename codes so existing preset_id FKs stay valid (update echo_8 before echo_4 to avoid unique clash).

update public.transition_presets
set
  code = 'echo_16',
  label = 'echo 16',
  description = '16 half-beat rebounds with fade-out (same step as stutter; longer than echo 8).'
where code = 'echo_8';

update public.transition_presets
set
  code = 'echo_8',
  label = 'echo 8',
  description = '8 half-beat rebounds with fade-out (same step as stutter 8; replaces former echo 4 length).'
where code = 'echo_4';
