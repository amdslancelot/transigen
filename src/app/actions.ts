"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { extractYoutubeVideoId } from "@/lib/youtube";
import { parseProposalTime } from "@/lib/timeInput";
import { isUuid, YOUTUBE_ID_RE } from "@/lib/validate";
import { fetchYoutubeVideoMeta } from "@/lib/youtubeData";
import { parseYoutubeTitle } from "@/lib/youtubeTitle";
import {
  fetchSpotifyAudioFeatures,
  searchSpotifyTrack,
} from "@/lib/spotifyApi";
import type { MediaRef } from "@/types/media";

async function findPairId(fromVideo: string, toVideo: string): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `select id from transition_pairs
     where from_media->>'provider' = 'youtube'
       and from_media->>'videoId' = $1
       and to_media->>'provider' = 'youtube'
       and to_media->>'videoId' = $2`,
    [fromVideo, toVideo],
  );
  return rows[0]?.id ?? null;
}

async function topProposalIdForPair(pairId: string): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `select id from top_transition_proposal_for_pair($1)`,
    [pairId],
  );
  return rows[0]?.id ?? null;
}

async function findOrCreatePair(fromVideo: string, toVideo: string) {
  const user = await requireUser();

  const existing = await findPairId(fromVideo, toVideo);
  if (existing) return existing;

  const fromMedia: MediaRef = { provider: "youtube", videoId: fromVideo, title: `A:${fromVideo}` };
  const toMedia: MediaRef = { provider: "youtube", videoId: toVideo, title: `B:${toVideo}` };
  const rows = await query<{ id: string }>(
    `insert into transition_pairs (from_media, to_media, created_by)
     values ($1, $2, $3)
     returning id`,
    [JSON.stringify(fromMedia), JSON.stringify(toMedia), user.id],
  );
  return rows[0].id;
}

export type TransitionProposalActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string };

const PRESETS_NEEDING_BPM = new Set([
  "fade",
  "fade_like",
  "echo_8",
  "echo_16",
  "stutter_8",
  "stutter_4",
]);

function parseParamsJson(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}

export async function createTransitionProposal(
  _prev: TransitionProposalActionState | undefined,
  formData: FormData,
): Promise<TransitionProposalActionState> {
  try {
    const user = await requireUser();
    const fromInput = String(formData.get("fromVideo") ?? "");
    const toInput = String(formData.get("toVideo") ?? "");
    const endPrevRaw = String(formData.get("endPrevSec") ?? "");
    const startNextRaw = String(formData.get("startNextSec") ?? "");
    const presetIdRaw = String(formData.get("presetId") ?? "");
    const prevBpmRaw = String(formData.get("prev_bpm") ?? "").trim();
    const paramsRaw = String(formData.get("params") ?? "");
    const note = String(formData.get("note") ?? "").trim();

    const fromVideo = extractYoutubeVideoId(fromInput);
    const toVideo = extractYoutubeVideoId(toInput);
    if (!fromVideo || !toVideo) {
      return { ok: false, error: "Invalid YouTube URLs / IDs for Song A or B." };
    }
    if (!presetIdRaw || !isUuid(presetIdRaw)) {
      return { ok: false, error: "Choose a transition preset." };
    }

    const presetRows = await query<{ id: string; code: string }>(
      `select id, code from transition_presets where id = $1`,
      [presetIdRaw],
    );
    const presetRow = presetRows[0];
    if (!presetRow) {
      return { ok: false, error: "Invalid preset." };
    }

    const presetCode = presetRow.code;

    let prev_bpm: number | null = null;
    if (PRESETS_NEEDING_BPM.has(presetCode)) {
      const n = Number(prevBpmRaw);
      if (!Number.isFinite(n) || n <= 0 || n > 300) {
        return { ok: false, error: "Enter a valid BPM (1–300) for this preset." };
      }
      prev_bpm = Math.round(n * 100) / 100;
    }

    let paramsToInsert: Record<string, unknown> = {};
    if (presetCode === "fade" || presetCode === "fade_like") {
      const parsed = parseParamsJson(paramsRaw);
      const fb = parsed.fade_bars;
      const n = typeof fb === "number" ? fb : Number(fb);
      if (![1, 2, 4].includes(n)) {
        return { ok: false, error: "Fade duration must be 1, 2, or 4 bars." };
      }
      paramsToInsert = { fade_bars: n };
    }

    const endSec = parseProposalTime(endPrevRaw);
    const startSec = parseProposalTime(startNextRaw);
    if (endSec == null) {
      return {
        ok: false,
        error: "Invalid end time on Song A (use m:ss or m:ss.fff, e.g. 1:30.5).",
      };
    }
    if (startSec == null) {
      return {
        ok: false,
        error: "Invalid start time on Song B (use m:ss or m:ss.fff, e.g. 0:05.25).",
      };
    }

    const pairId = await findOrCreatePair(fromVideo, toVideo);

    try {
      await query(
        `insert into transition_proposals
           (pair_id, proposed_by, end_prev_sec, start_next_sec, preset_id, prev_bpm, params, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          pairId,
          user.id,
          endSec,
          startSec,
          presetIdRaw,
          prev_bpm,
          JSON.stringify(paramsToInsert),
          note || null,
        ],
      );
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "23505") {
        return {
          ok: false,
          error:
            "Duplicate proposal: the same Song A end time, Song B start time, and preset are already saved.",
        };
      }
      throw e;
    }

    revalidatePath("/transition");
    revalidatePath("/transition/new");
    return { ok: true, message: "Proposal saved." };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Save failed.";
    return { ok: false, error: msg };
  }
}

export type YoutubeMetaResult =
  | {
      ok: true;
      videoId: string;
      title: string;
      channelTitle: string;
      durationSec: number | null;
      cached: boolean;
    }
  | { ok: false; error: string };

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

type YoutubeCacheRow = {
  video_id: string;
  title: string | null;
  channel_title: string | null;
  duration_sec: number | null;
  fetched_at: Date | string | null;
};

function isFresh(fetchedAt: Date | string | null): boolean {
  if (!fetchedAt) return false;
  return Date.now() - new Date(fetchedAt).getTime() < CACHE_TTL_MS;
}

async function upsertYoutubeCache(meta: NonNullable<Awaited<ReturnType<typeof fetchYoutubeVideoMeta>>>) {
  await query(
    `insert into youtube_video_cache
       (video_id, title, channel_title, channel_id, duration_sec, description, thumbnails, raw, fetched_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())
     on conflict (video_id) do update set
       title = excluded.title,
       channel_title = excluded.channel_title,
       channel_id = excluded.channel_id,
       duration_sec = excluded.duration_sec,
       description = excluded.description,
       thumbnails = excluded.thumbnails,
       raw = excluded.raw,
       fetched_at = excluded.fetched_at`,
    [
      meta.videoId,
      meta.title,
      meta.channelTitle,
      meta.channelId,
      meta.durationSec,
      meta.description,
      JSON.stringify(meta.thumbnails ?? null),
      JSON.stringify(meta.raw ?? null),
    ],
  );
}

export async function lookupYoutubeMeta(rawInput: string): Promise<YoutubeMetaResult> {
  try {
    await requireUser();
    const videoId = extractYoutubeVideoId(rawInput);
    if (!videoId) return { ok: false, error: "Invalid YouTube URL or ID." };

    const cachedRows = await query<YoutubeCacheRow>(
      `select video_id, title, channel_title, duration_sec, fetched_at
       from youtube_video_cache where video_id = $1`,
      [videoId],
    );
    const cached = cachedRows[0];

    if (cached && isFresh(cached.fetched_at)) {
      return {
        ok: true,
        videoId,
        title: cached.title ?? "",
        channelTitle: cached.channel_title ?? "",
        durationSec: cached.duration_sec ?? null,
        cached: true,
      };
    }

    const meta = await fetchYoutubeVideoMeta(videoId);
    if (!meta) {
      return { ok: false, error: "Video not found via YouTube Data API." };
    }

    await upsertYoutubeCache(meta);

    return {
      ok: true,
      videoId,
      title: meta.title,
      channelTitle: meta.channelTitle,
      durationSec: meta.durationSec,
      cached: false,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "YouTube lookup failed.";
    return { ok: false, error: msg };
  }
}

export type AutoBpmResult =
  | {
      ok: true;
      bpm: number;
      matchedTitle: string;
      matchedArtist: string;
      cached: boolean;
    }
  | { ok: false; error: string };

async function getOrFetchYoutubeMeta(videoId: string) {
  const cachedRows = await query<YoutubeCacheRow>(
    `select video_id, title, channel_title, duration_sec, fetched_at
     from youtube_video_cache where video_id = $1`,
    [videoId],
  );
  const cached = cachedRows[0];

  if (cached && isFresh(cached.fetched_at)) {
    return {
      title: cached.title ?? "",
      channelTitle: cached.channel_title ?? "",
      durationSec: cached.duration_sec ?? null,
    };
  }

  const meta = await fetchYoutubeVideoMeta(videoId);
  if (!meta) return null;
  await upsertYoutubeCache(meta);
  return {
    title: meta.title,
    channelTitle: meta.channelTitle,
    durationSec: meta.durationSec,
  };
}

async function upsertYoutubeSpotifyLink(
  videoId: string,
  spotifyTrackId: string | null,
  matchQuery: string,
  matchStatus: string,
) {
  await query(
    `insert into youtube_spotify_link (video_id, spotify_track_id, match_query, match_status, fetched_at)
     values ($1, $2, $3, $4, now())
     on conflict (video_id) do update set
       spotify_track_id = excluded.spotify_track_id,
       match_query = excluded.match_query,
       match_status = excluded.match_status,
       fetched_at = excluded.fetched_at`,
    [videoId, spotifyTrackId, matchQuery, matchStatus],
  );
}

export async function autoBpmForYoutube(rawInput: string): Promise<AutoBpmResult> {
  try {
    await requireUser();
    const videoId = extractYoutubeVideoId(rawInput);
    if (!videoId) return { ok: false, error: "Invalid YouTube URL or ID." };

    const linkRows = await query<{
      spotify_track_id: string | null;
      match_status: string;
      fetched_at: Date | string | null;
    }>(
      `select spotify_track_id, match_status, fetched_at
       from youtube_spotify_link where video_id = $1`,
      [videoId],
    );
    const linkRow = linkRows[0];

    if (linkRow && isFresh(linkRow.fetched_at)) {
      if (linkRow.match_status === "not_found") {
        return { ok: false, error: "No Spotify match found for this title (cached)." };
      }
      if (linkRow.spotify_track_id) {
        const trackRows = await query<{ name: string | null; artists: string | null; bpm: string | number | null }>(
          `select name, artists, bpm from spotify_track_cache where spotify_track_id = $1`,
          [linkRow.spotify_track_id],
        );
        const trackRow = trackRows[0];
        if (trackRow && trackRow.bpm != null) {
          return {
            ok: true,
            bpm: Number(trackRow.bpm),
            matchedTitle: trackRow.name ?? "",
            matchedArtist: trackRow.artists ?? "",
            cached: true,
          };
        }
      }
    }

    const meta = await getOrFetchYoutubeMeta(videoId);
    if (!meta) return { ok: false, error: "YouTube video not found." };

    const parsed = parseYoutubeTitle(meta.title, meta.channelTitle);
    const matchQuery = parsed.artist
      ? `track:${parsed.title} artist:${parsed.artist}`
      : parsed.title;

    const hit = await searchSpotifyTrack(parsed.title, parsed.artist);
    if (!hit) {
      await upsertYoutubeSpotifyLink(videoId, null, matchQuery, "not_found");
      return { ok: false, error: "No Spotify match found for this title." };
    }

    const features = await fetchSpotifyAudioFeatures(hit.trackId);
    if (!features) {
      await query(
        `insert into spotify_track_cache (spotify_track_id, name, artists, album, duration_ms, bpm, raw, fetched_at)
         values ($1, $2, $3, $4, $5, null, $6, now())
         on conflict (spotify_track_id) do update set
           name = excluded.name,
           artists = excluded.artists,
           album = excluded.album,
           duration_ms = excluded.duration_ms,
           bpm = excluded.bpm,
           raw = excluded.raw,
           fetched_at = excluded.fetched_at`,
        [hit.trackId, hit.name, hit.artists, hit.album, hit.durationMs, JSON.stringify(hit.raw ?? null)],
      );
      await upsertYoutubeSpotifyLink(videoId, hit.trackId, matchQuery, "no_features");
      return {
        ok: false,
        error: "Spotify track found but audio-features unavailable (403?).",
      };
    }

    await query(
      `insert into spotify_track_cache
         (spotify_track_id, name, artists, album, duration_ms, bpm, time_signature, song_key, mode, energy, danceability, raw, fetched_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       on conflict (spotify_track_id) do update set
         name = excluded.name,
         artists = excluded.artists,
         album = excluded.album,
         duration_ms = excluded.duration_ms,
         bpm = excluded.bpm,
         time_signature = excluded.time_signature,
         song_key = excluded.song_key,
         mode = excluded.mode,
         energy = excluded.energy,
         danceability = excluded.danceability,
         raw = excluded.raw,
         fetched_at = excluded.fetched_at`,
      [
        hit.trackId,
        hit.name,
        hit.artists,
        hit.album,
        hit.durationMs,
        features.bpm,
        features.timeSignature,
        features.key,
        features.mode,
        features.energy,
        features.danceability,
        JSON.stringify(features.raw ?? null),
      ],
    );

    await upsertYoutubeSpotifyLink(videoId, hit.trackId, matchQuery, "matched");

    return {
      ok: true,
      bpm: features.bpm,
      matchedTitle: hit.name,
      matchedArtist: hit.artists,
      cached: false,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "BPM lookup failed.";
    return { ok: false, error: msg };
  }
}

export async function deleteTransitionProposal(formData: FormData) {
  const user = await requireUser();
  const proposalId = String(formData.get("proposalId") ?? "");
  if (!proposalId || !isUuid(proposalId)) throw new Error("Missing proposal");

  await query(
    `delete from transition_proposals where id = $1 and proposed_by = $2`,
    [proposalId, user.id],
  );
  revalidatePath("/transition");
  revalidatePath("/transition/new");
}

export async function voteProposal(formData: FormData) {
  const user = await requireUser();
  const proposalId = String(formData.get("proposalId") ?? "");
  const mode = String(formData.get("mode") ?? "up");
  if (!isUuid(proposalId)) return;

  if (mode === "remove") {
    await query(
      `delete from transition_votes where proposal_id = $1 and user_id = $2`,
      [proposalId, user.id],
    );
  } else {
    await query(
      `insert into transition_votes (proposal_id, user_id)
       values ($1, $2)
       on conflict do nothing`,
      [proposalId, user.id],
    );
  }
  revalidatePath("/transition");
  revalidatePath("/transition/new");
}

export async function createRoom(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const firstSong = String(formData.get("firstSong") ?? "").trim();
  const firstVideoId = extractYoutubeVideoId(firstSong);
  if (!title || !slug || !firstVideoId) {
    throw new Error("Invalid room title, slug, or first song");
  }

  const startMedia: MediaRef = {
    provider: "youtube",
    videoId: firstVideoId,
    title: `Start:${firstVideoId}`,
  };

  const rows = await query<{ id: string }>(
    `insert into rooms (owner_id, title, slug, start_media)
     values ($1, $2, $3, $4)
     returning id`,
    [user.id, title, slug, JSON.stringify(startMedia)],
  );
  const roomId = rows[0].id;

  await query(
    `insert into room_members (room_id, user_id) values ($1, $2) on conflict do nothing`,
    [roomId, user.id],
  );

  revalidatePath("/");
  revalidatePath("/room");
  return roomId;
}

export async function updateRoomTitle(roomId: string, nextTitle: string) {
  const user = await requireUser();
  const title = nextTitle.trim();
  if (!roomId || !isUuid(roomId)) throw new Error("Missing room.");
  if (!title) throw new Error("Room name cannot be empty.");
  if (title.length > 200) throw new Error("Room name is too long (max 200 characters).");

  const rows = await query<{ id: string }>(
    `update rooms set title = $1 where id = $2 and owner_id = $3 returning id`,
    [title, roomId, user.id],
  );
  if (rows.length === 0) throw new Error("You can only rename rooms you own.");

  revalidatePath(`/room/${roomId}`);
  revalidatePath("/room");
}

export async function incrementRoomPlayCount(roomId: string) {
  try {
    await requireUser();
    if (!roomId || !isUuid(roomId)) return;
    await query(`select increment_room_play_count($1)`, [roomId]);
    revalidatePath("/room");
  } catch {
    /* noop */
  }
}

export async function addRoomSong(formData: FormData) {
  const user = await requireUser();
  const roomId = String(formData.get("roomId") ?? "");
  const previousVideo = String(formData.get("previousVideo") ?? "");
  const nextSong = String(formData.get("nextSong") ?? "");
  const nextVideo = extractYoutubeVideoId(nextSong);
  if (!roomId || !isUuid(roomId) || !nextVideo) throw new Error("Invalid room or song");

  const member = await query<{ room_id: string }>(
    `select room_id from room_members where room_id = $1 and user_id = $2`,
    [roomId, user.id],
  );
  if (member.length === 0) {
    throw new Error("You must join the room before editing the set.");
  }

  const items = await query<{ position: number }>(
    `select position from room_set_items where room_id = $1 order by position desc limit 1`,
    [roomId],
  );
  const nextPosition = items[0]?.position != null ? Number(items[0].position) + 1 : 1;

  let pairId: string | null = null;
  let bestProposalId: string | null = null;
  if (previousVideo) {
    pairId = await findPairId(previousVideo, nextVideo);
    if (pairId) {
      bestProposalId = await topProposalIdForPair(pairId);
    }
  }

  const media: MediaRef = { provider: "youtube", videoId: nextVideo, title: `Song:${nextVideo}` };

  await query(
    `insert into room_set_items
       (room_id, position, media, transition_pair_id_from_prev, best_proposal_id_from_prev)
     values ($1, $2, $3, $4, $5)`,
    [roomId, nextPosition, JSON.stringify(media), pairId, bestProposalId],
  );

  revalidatePath(`/room/${roomId}`);
  revalidatePath("/room");
}

export async function triggerIngest(videoIds: string[]): Promise<void> {
  await requireUser();
  const ids = videoIds.filter((v) => YOUTUBE_ID_RE.test(v));
  if (!ids.length) return;
  try {
    await query(
      `insert into ingest_jobs (video_id)
       select unnest($1::text[])
       on conflict (video_id) do nothing`,
      [ids],
    );
  } catch {
    /* ingest is best-effort; the page must still render */
  }
}

export async function fetchTransitionDestinations(fromVideoId: string): Promise<string[]> {
  await requireUser();
  if (!YOUTUBE_ID_RE.test(fromVideoId)) return [];
  const rows = await query<{ video_id: string | null }>(
    `select to_media->>'videoId' as video_id
     from transition_pairs
     where from_media->>'provider' = 'youtube'
       and from_media->>'videoId' = $1`,
    [fromVideoId],
  );
  return Array.from(
    new Set(rows.map((r) => r.video_id ?? "").filter((v) => v.length > 0)),
  );
}

export async function fetchVideoLabels(videoIds: string[]): Promise<Record<string, string>> {
  await requireUser();
  const ids = Array.from(new Set(videoIds.filter((v) => YOUTUBE_ID_RE.test(v))));
  if (ids.length === 0) return {};
  const rows = await query<{ video_id: string; title: string | null; channel_title: string | null }>(
    `select video_id, title, channel_title from youtube_video_cache where video_id = any($1::text[])`,
    [ids],
  );
  const out: Record<string, string> = {};
  for (const row of rows) {
    const title = (row.title ?? "").trim();
    const ch = (row.channel_title ?? "").trim();
    out[row.video_id] = ch && title ? `${ch} - ${title}` : title || row.video_id;
  }
  return out;
}

export async function confirmRoomChain(roomId: string, chainVideoIds: string[]) {
  const user = await requireUser();
  if (!roomId || !isUuid(roomId) || !Array.isArray(chainVideoIds) || chainVideoIds.length === 0) {
    throw new Error("Nothing to add.");
  }

  for (const id of chainVideoIds) {
    if (!YOUTUBE_ID_RE.test(id)) {
      throw new Error(`Invalid YouTube id: ${id}`);
    }
  }

  const member = await query<{ room_id: string }>(
    `select room_id from room_members where room_id = $1 and user_id = $2`,
    [roomId, user.id],
  );
  if (member.length === 0) {
    throw new Error("You must join the room before editing the set.");
  }

  const roomRows = await query<{ start_media: MediaRef }>(
    `select start_media from rooms where id = $1`,
    [roomId],
  );
  const room = roomRows[0];
  if (!room) throw new Error("Room not found.");

  const lastRows = await query<{ position: number; media: MediaRef }>(
    `select position, media from room_set_items where room_id = $1 order by position desc limit 1`,
    [roomId],
  );

  const startMedia = room.start_media;
  let previousVideo = startMedia.videoId ?? "";
  let nextPosition = 1;
  if (lastRows[0]) {
    previousVideo = lastRows[0].media.videoId ?? previousVideo;
    nextPosition = Number(lastRows[0].position) + 1;
  }

  for (const nextVideo of chainVideoIds) {
    const pairId = await findPairId(previousVideo, nextVideo);
    if (!pairId) {
      throw new Error(
        `No saved transition from ${previousVideo} to ${nextVideo}. Create the pair on /transition/new first.`,
      );
    }

    const bestProposalId = await topProposalIdForPair(pairId);

    const media: MediaRef = { provider: "youtube", videoId: nextVideo, title: `Song:${nextVideo}` };
    await query(
      `insert into room_set_items
         (room_id, position, media, transition_pair_id_from_prev, best_proposal_id_from_prev)
       values ($1, $2, $3, $4, $5)`,
      [roomId, nextPosition, JSON.stringify(media), pairId, bestProposalId],
    );

    previousVideo = nextVideo;
    nextPosition += 1;
  }

  revalidatePath(`/room/${roomId}`);
  revalidatePath("/room");
}
