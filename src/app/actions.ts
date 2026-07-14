"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { extractYoutubeVideoId } from "@/lib/youtube";
import { parseProposalTime } from "@/lib/timeInput";
import { fetchYoutubeVideoMeta } from "@/lib/youtubeData";
import { parseYoutubeTitle } from "@/lib/youtubeTitle";
import {
  fetchSpotifyAudioFeatures,
  searchSpotifyTrack,
} from "@/lib/spotifyApi";
import type { MediaRef } from "@/types/media";

async function findOrCreatePair(fromVideo: string, toVideo: string) {
  const user = await requireUser();
  const supabase = await getSupabaseServerClient();

  const { data: existing } = await supabase
    .from("transition_pairs")
    .select("*")
    .eq("from_media->>provider", "youtube")
    .eq("from_media->>videoId", fromVideo)
    .eq("to_media->>provider", "youtube")
    .eq("to_media->>videoId", toVideo)
    .maybeSingle();

  if (existing) {
    return existing.id as string;
  }

  const fromMedia: MediaRef = { provider: "youtube", videoId: fromVideo, title: `A:${fromVideo}` };
  const toMedia: MediaRef = { provider: "youtube", videoId: toVideo, title: `B:${toVideo}` };
  const { data, error } = await supabase
    .from("transition_pairs")
    .insert({
      from_media: fromMedia,
      to_media: toMedia,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
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
    if (!presetIdRaw) {
      return { ok: false, error: "Choose a transition preset." };
    }

    const supabase = await getSupabaseServerClient();
    const { data: presetRow, error: presetErr } = await supabase
      .from("transition_presets")
      .select("id,code")
      .eq("id", presetIdRaw)
      .maybeSingle();

    if (presetErr || !presetRow) {
      return { ok: false, error: "Invalid preset." };
    }

    const presetCode = presetRow.code as string;

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

    const { error } = await supabase.from("transition_proposals").insert({
      pair_id: pairId,
      proposed_by: user.id,
      end_prev_sec: endSec,
      start_next_sec: startSec,
      preset_id: presetIdRaw,
      prev_bpm,
      params: paramsToInsert,
      note: note || null,
    });

    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        return {
          ok: false,
          error:
            "Duplicate proposal: the same Song A end time, Song B start time, and preset are already saved.",
        };
      }
      return { ok: false, error: error.message };
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

export async function lookupYoutubeMeta(rawInput: string): Promise<YoutubeMetaResult> {
  try {
    await requireUser();
    const videoId = extractYoutubeVideoId(rawInput);
    if (!videoId) return { ok: false, error: "Invalid YouTube URL or ID." };

    const supabase = await getSupabaseServerClient();
    const { data: cached } = await supabase
      .from("youtube_video_cache")
      .select("video_id,title,channel_title,duration_sec,fetched_at")
      .eq("video_id", videoId)
      .maybeSingle();

    if (
      cached &&
      cached.fetched_at &&
      Date.now() - new Date(cached.fetched_at as string).getTime() < CACHE_TTL_MS
    ) {
      return {
        ok: true,
        videoId,
        title: (cached.title as string) ?? "",
        channelTitle: (cached.channel_title as string) ?? "",
        durationSec: (cached.duration_sec as number | null) ?? null,
        cached: true,
      };
    }

    const meta = await fetchYoutubeVideoMeta(videoId);
    if (!meta) {
      return { ok: false, error: "Video not found via YouTube Data API." };
    }

    await supabase.from("youtube_video_cache").upsert(
      {
        video_id: meta.videoId,
        title: meta.title,
        channel_title: meta.channelTitle,
        channel_id: meta.channelId,
        duration_sec: meta.durationSec,
        description: meta.description,
        thumbnails: meta.thumbnails,
        raw: meta.raw as Record<string, unknown>,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "video_id" },
    );

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

async function getOrFetchYoutubeMeta(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  videoId: string,
) {
  const { data: cached } = await supabase
    .from("youtube_video_cache")
    .select("video_id,title,channel_title,duration_sec,fetched_at")
    .eq("video_id", videoId)
    .maybeSingle();

  const fresh =
    cached &&
    cached.fetched_at &&
    Date.now() - new Date(cached.fetched_at as string).getTime() < CACHE_TTL_MS;

  if (fresh && cached) {
    return {
      title: (cached.title as string) ?? "",
      channelTitle: (cached.channel_title as string) ?? "",
      durationSec: (cached.duration_sec as number | null) ?? null,
    };
  }

  const meta = await fetchYoutubeVideoMeta(videoId);
  if (!meta) return null;
  await supabase.from("youtube_video_cache").upsert(
    {
      video_id: meta.videoId,
      title: meta.title,
      channel_title: meta.channelTitle,
      channel_id: meta.channelId,
      duration_sec: meta.durationSec,
      description: meta.description,
      thumbnails: meta.thumbnails,
      raw: meta.raw as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "video_id" },
  );
  return {
    title: meta.title,
    channelTitle: meta.channelTitle,
    durationSec: meta.durationSec,
  };
}

export async function autoBpmForYoutube(rawInput: string): Promise<AutoBpmResult> {
  try {
    await requireUser();
    const videoId = extractYoutubeVideoId(rawInput);
    if (!videoId) return { ok: false, error: "Invalid YouTube URL or ID." };

    const supabase = await getSupabaseServerClient();

    const { data: linkRow } = await supabase
      .from("youtube_spotify_link")
      .select("spotify_track_id,match_status,fetched_at")
      .eq("video_id", videoId)
      .maybeSingle();

    const linkFresh =
      linkRow &&
      linkRow.fetched_at &&
      Date.now() - new Date(linkRow.fetched_at as string).getTime() < CACHE_TTL_MS;

    if (linkFresh && linkRow) {
      if (linkRow.match_status === "not_found") {
        return { ok: false, error: "No Spotify match found for this title (cached)." };
      }
      if (linkRow.spotify_track_id) {
        const { data: trackRow } = await supabase
          .from("spotify_track_cache")
          .select("name,artists,bpm")
          .eq("spotify_track_id", linkRow.spotify_track_id as string)
          .maybeSingle();
        if (trackRow && trackRow.bpm != null) {
          return {
            ok: true,
            bpm: Number(trackRow.bpm),
            matchedTitle: (trackRow.name as string) ?? "",
            matchedArtist: (trackRow.artists as string) ?? "",
            cached: true,
          };
        }
      }
    }

    const meta = await getOrFetchYoutubeMeta(supabase, videoId);
    if (!meta) return { ok: false, error: "YouTube video not found." };

    const parsed = parseYoutubeTitle(meta.title, meta.channelTitle);
    const matchQuery = parsed.artist
      ? `track:${parsed.title} artist:${parsed.artist}`
      : parsed.title;

    const hit = await searchSpotifyTrack(parsed.title, parsed.artist);
    if (!hit) {
      await supabase.from("youtube_spotify_link").upsert(
        {
          video_id: videoId,
          spotify_track_id: null,
          match_query: matchQuery,
          match_status: "not_found",
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "video_id" },
      );
      return { ok: false, error: "No Spotify match found for this title." };
    }

    const features = await fetchSpotifyAudioFeatures(hit.trackId);
    if (!features) {
      await supabase.from("spotify_track_cache").upsert(
        {
          spotify_track_id: hit.trackId,
          name: hit.name,
          artists: hit.artists,
          album: hit.album,
          duration_ms: hit.durationMs,
          bpm: null,
          raw: hit.raw as Record<string, unknown>,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "spotify_track_id" },
      );
      await supabase.from("youtube_spotify_link").upsert(
        {
          video_id: videoId,
          spotify_track_id: hit.trackId,
          match_query: matchQuery,
          match_status: "no_features",
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "video_id" },
      );
      return {
        ok: false,
        error: "Spotify track found but audio-features unavailable (403?).",
      };
    }

    await supabase.from("spotify_track_cache").upsert(
      {
        spotify_track_id: hit.trackId,
        name: hit.name,
        artists: hit.artists,
        album: hit.album,
        duration_ms: hit.durationMs,
        bpm: features.bpm,
        time_signature: features.timeSignature,
        song_key: features.key,
        mode: features.mode,
        energy: features.energy,
        danceability: features.danceability,
        raw: features.raw as Record<string, unknown>,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "spotify_track_id" },
    );

    await supabase.from("youtube_spotify_link").upsert(
      {
        video_id: videoId,
        spotify_track_id: hit.trackId,
        match_query: matchQuery,
        match_status: "matched",
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "video_id" },
    );

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
  if (!proposalId) throw new Error("Missing proposal");

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from("transition_proposals")
    .delete()
    .eq("id", proposalId)
    .eq("proposed_by", user.id);

  if (error) throw error;
  revalidatePath("/transition");
  revalidatePath("/transition/new");
}

export async function voteProposal(formData: FormData) {
  const user = await requireUser();
  const proposalId = String(formData.get("proposalId") ?? "");
  const mode = String(formData.get("mode") ?? "up");
  const supabase = await getSupabaseServerClient();

  if (mode === "remove") {
    await supabase
      .from("transition_votes")
      .delete()
      .eq("proposal_id", proposalId)
      .eq("user_id", user.id);
  } else {
    await supabase.from("transition_votes").upsert({
      proposal_id: proposalId,
      user_id: user.id,
    });
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

  const supabase = await getSupabaseServerClient();
  const startMedia: MediaRef = {
    provider: "youtube",
    videoId: firstVideoId,
    title: `Start:${firstVideoId}`,
  };

  const { data: room, error } = await supabase
    .from("rooms")
    .insert({
      owner_id: user.id,
      title,
      slug,
      start_media: startMedia,
    })
    .select("id")
    .single();
  if (error) throw error;

  await supabase.from("room_members").upsert({
    room_id: room.id,
    user_id: user.id,
  });

  revalidatePath("/");
  revalidatePath("/room");
  return room.id as string;
}

export async function updateRoomTitle(roomId: string, nextTitle: string) {
  const user = await requireUser();
  const title = nextTitle.trim();
  if (!roomId) throw new Error("Missing room.");
  if (!title) throw new Error("Room name cannot be empty.");
  if (title.length > 200) throw new Error("Room name is too long (max 200 characters).");

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("rooms")
    .update({ title })
    .eq("id", roomId)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("You can only rename rooms you own.");

  revalidatePath(`/room/${roomId}`);
  revalidatePath("/room");
}

export async function incrementRoomPlayCount(roomId: string) {
  try {
    await requireUser();
    if (!roomId) return;
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.rpc("increment_room_play_count", { p_room_id: roomId });
    if (error) return;
    revalidatePath("/room");
  } catch {
    /* noop */
  }
}

export async function addRoomSong(formData: FormData) {
  await requireUser();
  const roomId = String(formData.get("roomId") ?? "");
  const previousVideo = String(formData.get("previousVideo") ?? "");
  const nextSong = String(formData.get("nextSong") ?? "");
  const nextVideo = extractYoutubeVideoId(nextSong);
  if (!roomId || !nextVideo) throw new Error("Invalid room or song");

  const supabase = await getSupabaseServerClient();

  const { data: items } = await supabase
    .from("room_set_items")
    .select("position")
    .eq("room_id", roomId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPosition = items?.[0]?.position != null ? Number(items[0].position) + 1 : 1;

  let pairId: string | null = null;
  let bestProposalId: string | null = null;
  if (previousVideo) {
    const { data: pair } = await supabase
      .from("transition_pairs")
      .select("id")
      .eq("from_media->>provider", "youtube")
      .eq("from_media->>videoId", previousVideo)
      .eq("to_media->>provider", "youtube")
      .eq("to_media->>videoId", nextVideo)
      .maybeSingle();
    pairId = (pair?.id as string) ?? null;

    if (pairId) {
      const { data: rows } = await supabase.rpc("top_transition_proposal_for_pair", {
        p_pair_id: pairId,
      });
      bestProposalId = (rows?.[0]?.id as string | undefined) ?? null;
    }
  }

  const media: MediaRef = { provider: "youtube", videoId: nextVideo, title: `Song:${nextVideo}` };

  await supabase.from("room_set_items").insert({
    room_id: roomId,
    position: nextPosition,
    media,
    transition_pair_id_from_prev: pairId,
    best_proposal_id_from_prev: bestProposalId,
  });

  revalidatePath(`/room/${roomId}`);
  revalidatePath("/room");
}

export async function triggerIngest(videoIds: string[]): Promise<void> {
  if (!videoIds.length) return;
  const supabase = await getSupabaseServerClient();
  await supabase
    .from("ingest_jobs")
    .upsert(videoIds.map((v) => ({ video_id: v })), { onConflict: "video_id", ignoreDuplicates: true });
}

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export async function confirmRoomChain(roomId: string, chainVideoIds: string[]) {
  const user = await requireUser();
  if (!roomId || !Array.isArray(chainVideoIds) || chainVideoIds.length === 0) {
    throw new Error("Nothing to add.");
  }

  for (const id of chainVideoIds) {
    if (!YT_ID_RE.test(id)) {
      throw new Error(`Invalid YouTube id: ${id}`);
    }
  }

  const supabase = await getSupabaseServerClient();

  const { data: member } = await supabase
    .from("room_members")
    .select("room_id")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    throw new Error("You must join the room before editing the set.");
  }

  const { data: room } = await supabase.from("rooms").select("start_media").eq("id", roomId).single();
  if (!room) throw new Error("Room not found.");

  const { data: lastRows } = await supabase
    .from("room_set_items")
    .select("position, media")
    .eq("room_id", roomId)
    .order("position", { ascending: false })
    .limit(1);

  const startMedia = room.start_media as MediaRef;
  let previousVideo = startMedia.videoId ?? "";
  let nextPosition = 1;
  if (lastRows?.[0]) {
    const lastMedia = lastRows[0].media as MediaRef;
    previousVideo = lastMedia.videoId ?? previousVideo;
    nextPosition = Number(lastRows[0].position) + 1;
  }

  for (const nextVideo of chainVideoIds) {
    const { data: pair } = await supabase
      .from("transition_pairs")
      .select("id")
      .eq("from_media->>provider", "youtube")
      .eq("from_media->>videoId", previousVideo)
      .eq("to_media->>provider", "youtube")
      .eq("to_media->>videoId", nextVideo)
      .maybeSingle();

    if (!pair?.id) {
      throw new Error(
        `No saved transition from ${previousVideo} to ${nextVideo}. Create the pair on /transition/new first.`,
      );
    }

    let bestProposalId: string | null = null;
    const { data: rows } = await supabase.rpc("top_transition_proposal_for_pair", {
      p_pair_id: pair.id,
    });
    bestProposalId = (rows?.[0]?.id as string | undefined) ?? null;

    const media: MediaRef = { provider: "youtube", videoId: nextVideo, title: `Song:${nextVideo}` };
    const { error } = await supabase.from("room_set_items").insert({
      room_id: roomId,
      position: nextPosition,
      media,
      transition_pair_id_from_prev: pair.id as string,
      best_proposal_id_from_prev: bestProposalId,
    });
    if (error) throw new Error(error.message);

    previousVideo = nextVideo;
    nextPosition += 1;
  }

  revalidatePath(`/room/${roomId}`);
  revalidatePath("/room");
}
