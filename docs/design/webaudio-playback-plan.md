# Web Audio playback path — decision & execution plan

Status: decided, not started. Created 2026-07-21.
Builds on: [`audio-cache-feasibility.md`](./audio-cache-feasibility.md) (this is the concrete execution plan for that doc's unbuilt Phase 2, plus the sourcing/anti-bot decisions made on 2026-07-21).

## Goal

Move **playback audio** off the YouTube `<iframe>` and onto the **Web Audio API**, so transitions become sample-accurate and real DSP (EQ kill, echo, filter sweeps) becomes possible — replacing the current `YT.Player.setVolume()`/`seekTo()` hacks in `src/lib/transitionPresetTick.ts`.

This was triggered by the user pointing at **Cymatics HookLab**, which samples YouTube "without delay." The research below explains what HookLab actually does and why only its *architecture principle* (not its mechanism) ports to us.

## Background established on 2026-07-21

### What HookLab actually does (and why "no delay" is a trick)
- HookLab is a **native VST/AU plugin**, not a web app. It embeds a Chromium browser (almost certainly CEF — Chromium Embedded Framework; inferred, not confirmed by Cymatics).
- It **records** the embedded browser's audio output to a **local PCM buffer** via CEF's audio-loopback API ("the CEF tap"), then chops/triggers that local buffer. "No downloads, no converters" is their marketing framing.
- The "no delay" is because you trigger a **locally-stored decoded buffer** through a real-time engine — *not* because they solved live-YouTube-stream latency. YouTube buffering only touches the one-time record step.

### Why HookLab's mechanism does NOT port to us
- We are a **browser web app** playing YouTube via a **cross-origin `<iframe>`**. Two hard walls block any client-only audio grab:
  1. **Signature cipher** — the real audio lives at signed, time-limited `googlevideo.com` URLs; getting one means running/deobfuscating YouTube's player JS (this is what `yt-dlp` does and why it needs constant updates).
  2. **CORS** — even with a valid URL, a browser `fetch()` to `googlevideo.com` is refused (no `Access-Control-Allow-Origin` for our origin). CORS is browser-enforced and cannot be disabled from page JS. **A server is the only way around it.**
- The CEF tap / `chrome.tabCapture` (extension) / `getDisplayMedia` paths all exist but require a **native/desktop/extension** product AND capture **in real time (1×)** — unacceptable for a setlist app needing whole tracks ahead of time. Ruled out.

### What we already have (grounding pass, 2026-07-21)
- **Server-side extraction already runs in prod**: `worker/worker.py:39` does `yt-dlp -x --audio-format m4a` to `/tmp`, beat-analyzes with librosa, then **deletes the m4a** (`worker.py:103`). Only BPM/beat grid is persisted (`track_analysis` table).
- **Job pipeline exists**: `ingest_jobs` queue → Postgres `LISTEN/NOTIFY` → SSE (`src/app/actions.ts:triggerIngest`, `db/migrations/0001_init.sql` trigger, `src/app/api/ingest-status/stream/route.ts`, `src/components/TrackIngestStatus.tsx`).
- **De-jitter already exists**: `src/lib/playbackClock.ts` linear-regresses `getCurrentTime()`; `RoomFullSetPlayer.tsx` already de-jitters both decks.
- **Zero Web Audio API anywhere** — grep for `AudioContext`/`AudioBuffer`/`decodeAudioData` in `src/` returns nothing. All mixing is iframe `setVolume`/`seekTo`.

## Decision

**Fetch-once + bounded cache, feeding client-side Web Audio playback.** (User chose this over "stay on iframe" and "on-demand + residential proxy" on 2026-07-21.)

Concretely:
1. **Going Web Audio means the iframe stops playing audio.** The `<iframe>` gets muted/hidden and kept **only as a fallback** for tracks that fail extraction. Audio plays from a decoded `AudioBuffer`. This is a real architectural commitment, not an add-on.
2. **Reuse the extraction we already do.** When the worker downloads a track's m4a for BPM analysis, **stop deleting it** — drop it into a **hard-capped LRU store** instead. Playback reads from there. This piggybacks on an extraction that already happens, so it adds **~zero new YouTube requests**.
3. **Client always ends the same way**, regardless of byte source: `fetch(compressed m4a) → decodeAudioData() → AudioBuffer → Web Audio dual-deck (AudioBufferSourceNode → GainNode → destination)`.

### Cache hierarchy (all tiers carry compressed m4a; decode is always last, on the client)
```
browser needs track audio
  → ① Client Cache API (user's disk, LRU budget e.g. ~200MB) ─hit→ decode → play
      → miss → ② Server LRU cache (OUR disk, HARD CAP e.g. 2GB, evict LRU) ─hit→ stream → ① → decode
          → miss → ③ yt-dlp extract (the only YouTube hit) → ② → ① → decode   [or iframe fallback]
```
- ① is the main store — lives on **users' devices**, keeps our server disk flat.
- ② is **optional and capped** — its job is to avoid re-hitting YouTube for hot tracks. Set the ceiling; it never grows past it. Set to 0 GB for pure on-demand (rejected here because it maximizes anti-bot exposure).
- ③ is the source of truth = the existing worker extraction.

### Why this reconciles all three of the user's constraints
| Concern | How it's satisfied |
|---|---|
| Don't fill my disk | Real storage lives on users' devices (①); server cache (②) is hard-capped (e.g. 2 GB ≈ ~500 tracks @ ~4 MB), never unbounded |
| Don't get caught on datacenter IP | Playback rides on the analysis extraction we **already** do → ~zero new YouTube requests → detection footprint ≈ today's |
| Sample-accurate transitions / real DSP | Client decodes to `AudioBuffer` and schedules on `AudioContext.currentTime` |

## The #1 risk and the three-way tension (read before executing)
- **Datacenter-IP anti-scraping is the top risk** (matches `audio-cache-feasibility.md`). OCI/cloud IPs get "Sign in to confirm you're not a bot", HTTP 403, PO-token demands.
- The three constraints pull against each other: **minimizing storage** (on-demand) **maximizes** YouTube hits → **maximizes** detection risk. **Minimizing detection risk** (fetch-once + cache) **needs** storage. You cannot minimize storage AND detection risk AND keep Web Audio quality. The chosen design resolves this only because the fetch-once hit is the *same* extraction already happening for analysis.
- Fallback plan if extraction reliability degrades: route yt-dlp through a **residential proxy** (ongoing $/GB) — deferred unless Step 0 shows it's needed.

## Execution plan

### Step 0 — GATE: verify current extraction health on OCI (do this first, cheap, decisive)
The whole plan assumes the worker's *current* `yt-dlp` on OCI is succeeding. Turn the risk into data:
- Check the running worker's logs / DB for `failed` `ingest_jobs` and `yt-dlp` 403 / "confirm you're not a bot" errors.
- Inspect `worker/worker.py` for retry/error-handling that betrays past 403 fights.
- **If extraction is already flaky → stop; do the residential-proxy conversation before building anything.**
- **If clean → proceed** (it's clean because analysis volume is low, once per track at add-time; note that on-demand playback would have blown this up — which is exactly why we chose fetch-once).

### Step 1 — Throwaway spike (validate before committing to Phase 2)
Deliberately tiny; does NOT need cache/LRU/fallback infra:
1. Take one already-analyzed track; have the worker **keep** its m4a (or hand-place one file where the app can serve it, same-origin).
2. Client: `fetch()` it → `decodeAudioData()` → one **hardcoded two-buffer Web Audio crossfade** between deck A and deck B.
3. **Measure** the cut/crossfade timing against the current iframe `setVolume` path.
- Success criterion: Web Audio lands the cut tighter on the beat (target <50 ms, ideally sample-accurate) AND decode/playback works on target devices. Then — and only then — build Phase 2. Throw the spike code away.

### Step 2 — Phase 2 build (only if spike passes)
Per `audio-cache-feasibility.md` Phase 2, with the sourcing decided above:
- **Worker**: stop deleting the analysis m4a; write it to the capped server store (tier ②) keyed by `video_id`; enforce the LRU ceiling.
- **Server**: endpoint to serve/stream a cached m4a to the browser (same-origin, CORS-clean). On tier-② miss, re-extract via yt-dlp (rare: added-then-evicted-then-replayed).
- **Client**: tier-① Cache API with an LRU budget + prefetch of the next track; Web Audio dual-deck behind a common `play/pause/seek/setGain/schedule` interface so `RoomFullSetPlayer` can swap between Web Audio and the iframe fallback.
- **Fallback (mandatory)**: any track that fails extraction falls back to the muted-then-audible iframe path.
- Discard the `seekTo`-based echo/stutter hack in `transitionPresetTick.ts`; replace with real `DelayNode`/`BiquadFilter` DSP.
- Watch the doc's mobile risks: iOS Safari `AudioContext` needs a user-gesture resume; fix decode window at 2 (current + next), never scale by `deviceMemory`.

## Defaults chosen (change if you disagree next session)
- Server cache (tier ②) ceiling: **2 GB** starting point; tune down to 500 MB if even that's too much.
- Client cache (tier ①) budget: ~200 MB (~50 tracks).
- Keep the iframe as a hard fallback — non-negotiable per the risk analysis.

## Not part of this plan
- **Deploy to staging/prod is NOT done.** The repo currently has a large uncommitted migration (Supabase → self-hosted Postgres + Auth.js + gelp-style OCI k3s deploy). That work is tracked in root `plan.md` (Status: done, but **not yet deployed**) and `deploy/README.md`. This audio plan is independent of that and should not be conflated with it.

## Resume pointers
- This plan: `docs/design/webaudio-playback-plan.md`
- Feasibility background: `docs/design/audio-cache-feasibility.md`
- Worker extraction: `worker/worker.py` (`:39` download, `:103` delete-to-replace)
- Job pipeline: `db/migrations/0001_init.sql`, `src/app/actions.ts` (`triggerIngest`), `src/app/api/ingest-status/stream/route.ts`
- Playback core to modify: `src/components/RoomFullSetPlayer.tsx`, `src/lib/transitionPresetTick.ts`, `src/lib/transitionBeatGrid.ts`, `src/lib/playbackClock.ts`
