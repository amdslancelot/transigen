-- Rename fade_like preset to fade (label + code).
update public.transition_presets
set
  code = 'fade',
  label = 'Fade',
  description = 'Crossfade from Song A into Song B at chosen timestamps (B continues after the handoff).'
where code = 'fade_like';
