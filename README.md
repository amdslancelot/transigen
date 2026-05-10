# Transigen (YouTube-first MVP)

Two-page collaborative app:

- `transition`: users propose and vote the best transition for a directed pair A -> B.
- `room`: users chain songs A -> B -> C using best pair transitions, capped to 1 hour.

## Setup

1. Install Node.js 20+.
2. `npm install`
3. Copy `.env.example` to `.env.local` and fill Supabase vars.
4. Apply SQL migration at `supabase/migrations/0001_init.sql` in your Supabase project.
5. `npm run dev`

## MVP behavior

- YouTube/Spotify transition proposals are timestamp-only:
  - `end_prev_sec` for song A
  - `start_next_sec` for song B
- Presets are labels only (real DSP FX reserved for mp3/wav phase).
- Waveform visuals are SoundCloud-like progress visuals, not audio-derived waveforms.
