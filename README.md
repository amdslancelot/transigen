# Transigen

DJ transition app. Paste YouTube links to build a setlist, play in a room with dual-deck beat-synced transitions.

Built with Next.js 15 + React 19 + Supabase (DB/Auth). Playback via YouTube IFrame API. Beat analysis via a separate Python worker.

---

## Setup

### 1. Install dependencies

```sh
npm install
```

### 2. Configure environment variables

Create `.env.local` in the project root:

```sh
NEXT_PUBLIC_SUPABASE_URL=       # Supabase project URL (Settings → API)
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Publishable key (Settings → API)
SUPABASE_SERVICE_ROLE_KEY=      # Secret key (Settings → API) — never expose to browser
NEXT_PUBLIC_AUTH_FLOW=dev_email_only  # see Auth flow section below
```

Optional:

```sh
YOUTUBE_API_KEY=                # Google Cloud → YouTube Data API v3 → Credentials
```

### 3. Apply database migrations

In Supabase SQL Editor (or via `supabase db push`), run all files in order:

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_transition_presets_params.sql
supabase/migrations/0003_metadata_caches.sql
supabase/migrations/0004_rename_fade_preset.sql
supabase/migrations/0004_room_play_count_directory.sql
supabase/migrations/0005_echo_preset_cadence.sql
supabase/migrations/0006_subsecond_proposal_times.sql
supabase/migrations/0007_track_analysis.sql
```

### 4. Configure Supabase Auth redirect URLs

In Supabase dashboard → Authentication → URL Configuration → Redirect URLs, add:

```
http://localhost:3000
http://localhost:3000/auth/callback
```

Set Site URL to `http://localhost:3000` for local dev.

### 5. Start the app

```sh
npm run dev
```

Open `http://localhost:3000`.

---

## Worker setup (beat analysis)

The worker downloads audio via yt-dlp and detects BPM + beat grid. Without it the app works but transitions use manually entered BPM.

### Prerequisites

Python 3.11+, ffmpeg installed on the system. On macOS, librosa requires LLVM 22 for its numba dependency:

```sh
brew install llvm ffmpeg
```

Then install Python deps with LLVM pointed at cmake:

```sh
CMAKE_PREFIX_PATH="/usr/local/opt/llvm" LLVM_CONFIG="/usr/local/opt/llvm/bin/llvm-config" pip install -r worker/requirements.txt
```

### Configure

Create `worker/.env` with the same Supabase project credentials:

```sh
SUPABASE_URL=              # same as NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY= # Secret key — same as in .env.local
```

### Run

```sh
python worker/worker.py
```

Or with Podman:

```sh
cd worker
podman build -t transigen-worker .
podman run --env-file .env transigen-worker
```

The worker polls `ingest_jobs` every 5 seconds. When a room loads, the app queues all songs automatically. The room UI shows "分析中 x/y 首" until analysis completes. Analyzed BPM and beat offset are cached permanently — each song is only downloaded once across all rooms.

---

## Auth flow

Set `NEXT_PUBLIC_AUTH_FLOW` in `.env.local` and restart `npm run dev`.

| Value | Behavior |
|---|---|
| `magic_link` | Email magic link (default) |
| `email_password` | Sign up + sign in with email and password |
| `dev_email_only` | Email only, no email sent. Requires `AUTH_DEV_EMAIL_BYPASS=1`, `SUPABASE_SERVICE_ROLE_KEY` (Secret key), and `AUTH_DEV_SHARED_PASSWORD`. **Local/dev only.** |

---

## Optional integrations

| Env var | Source | Used for |
|---|---|---|
| `YOUTUBE_API_KEY` | Google Cloud Console → YouTube Data API v3 | Auto-fill title, channel, duration when adding songs |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify Developer Dashboard | BPM lookup (note: Spotify audio-features API returns 403 for dev-mode apps since 2024 — effectively dead) |
