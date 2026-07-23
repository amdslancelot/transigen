# Transigen

DJ transition app. Paste YouTube links to build a setlist, play in a room with dual-deck beat-synced transitions.

Built with Next.js 15 + React 19 + PostgreSQL (raw SQL via `pg`) + Auth.js (Google OAuth). Playback via YouTube IFrame API. Beat analysis via a separate Python worker. Live ingest status via Server-Sent Events backed by Postgres LISTEN/NOTIFY.

---

## Setup

### 1. Install dependencies

```sh
npm install
```

### 2. Start PostgreSQL

Dev has no standalone database: it shares the minikube-hosted Postgres in the
`data` namespace that staging also uses (one shared server per cluster, one
database + one least-privilege `transigen_rw` role per app — the superuser is
for provisioning only, never an app credential).

```sh
minikube start --driver=vfkit                          # if not already running
deploy/stage.sh                                        # brings up the data plane + provisions transigen
kubectl -n data port-forward svc/postgres 54321:5432 & # dev tunnel; keep it running
```

If the shared Postgres is already up (e.g. another app deployed it), only the
port-forward is needed. Any other PostgreSQL 15+ works too — just point
`DATABASE_URL` at it.

### 3. Configure environment variables

Create `.env.local` in the project root (see `.env.example` for the full annotated list):

```sh
DATABASE_URL=postgresql://transigen_rw:transigen@localhost:54321/transigen
AUTH_SECRET=          # generate with: openssl rand -base64 32
AUTH_GOOGLE_ID=       # Google OAuth client, see step 4
AUTH_GOOGLE_SECRET=
```

Optional:

```sh
YOUTUBE_API_KEY=      # Google Cloud → YouTube Data API v3 → Credentials
```

### 4. Create a Google OAuth client

In [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application** with:

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

Copy the client ID and secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

### 5. Apply database migrations

```sh
npm run migrate
```

Applies every file in `db/migrations/` in order, tracked in a `schema_migrations` table; re-running is a no-op. Note: if you ever reset the database, sign out and back in — sessions reference user rows by id.

### 6. Start the app

```sh
npm run dev
```

Open `http://localhost:3000` and sign in with Google.

---

## Migrating data from a Supabase project

The schema in `db/migrations/0001_init.sql` matches the final Supabase-era schema, with one exception: `auth.users` is replaced by a `public.users` table keyed by Google account. To carry data over:

```sh
pg_dump --data-only --column-inserts \
  --table 'public.transition_*' --table 'public.room*' --table 'public.youtube_*' \
  --table 'public.spotify_track_cache' --table 'public.ingest_jobs' --table 'public.track_analysis' \
  "$SUPABASE_DB_URL" > data.sql
```

User-owned rows (`created_by`, `proposed_by`, `owner_id`, `user_id` columns) reference old Supabase auth user ids that will not exist in the new `users` table — you must first insert matching rows into `users` (or remap those columns to your new Google-provisioned user id) before restoring, or the foreign keys will reject the rows. Cache tables (`youtube_video_cache`, `spotify_track_cache`, `youtube_spotify_link`, `track_analysis`) have no user references and restore cleanly.

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

Create `worker/.env`:

```sh
DATABASE_URL=postgresql://transigen_rw:transigen@localhost:54321/transigen
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

(When running the worker in a container against the port-forwarded Postgres on the same machine, replace `localhost` in `DATABASE_URL` with the host address the container can reach, e.g. `host.containers.internal`.)

The worker polls `ingest_jobs` every 5 seconds. When a room loads, the app queues all songs automatically. The room UI shows "分析中 x/y 首" until analysis completes — updates arrive live over SSE (a Postgres trigger NOTIFYs on every `ingest_jobs` change). Analyzed BPM and beat offset are cached permanently — each song is only downloaded once across all rooms.

---

## Auth

Sign-in is Google OAuth only (Auth.js v5, JWT session cookies). Users are provisioned automatically on first sign-in into the `users` table, keyed by the stable Google subject id. There are no magic-link, password, or dev-bypass flows.

---

## Optional integrations

| Env var | Source | Used for |
|---|---|---|
| `YOUTUBE_API_KEY` | Google Cloud Console → YouTube Data API v3 | Auto-fill title, channel, duration when adding songs |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify Developer Dashboard | BPM lookup (note: Spotify audio-features API returns 403 for dev-mode apps since 2024 — effectively dead) |

---

## Deploy

Transigen uses the same stage/prod deploy setup as gelp: a **staging** deploy
onto a local minikube cluster, and a **prod** deploy onto the shared OCI k3s
server that gelp bootstrapped (transigen runs there as one app among several,
with its own namespace, hostname, and database in the shared Postgres). The
full runbook lives in `deploy/README.md`.

Migrations run automatically: the app applies `db/migrations/` lazily on its
first database use in each process, so deploys have no separate migrate step.

The worker intentionally stays local (see the Worker setup section above) — it
is not part of the deployed surface, because running yt-dlp from a datacenter
IP risks YouTube bot-detection failures that do not occur from a residential
machine.

### Staging (local minikube)

```sh
minikube start --driver=vfkit          # one-time (shared with gelp staging)
deploy/stage.sh                        # each deploy
kubectl -n transigen-staging port-forward svc/transigen 3000:80
```

### Prod (shared k3s server)

One-time, as root on the server (see `deploy/README.md` for the full list of
values and follow-up steps — DNS, GitHub webhook, Google OAuth redirect URI):

```sh
TRANSIGEN_HOST=<hostname> WEBHOOK_SECRET=<secret> TRANSIGEN_DB_PASSWORD=<pw> \
bash deploy/setup-app.sh
```

Afterwards every `git push` to `main` triggers the server's webhook, which
rebuilds the image on the box and rolls the deployment — no CI system, no
registry.
