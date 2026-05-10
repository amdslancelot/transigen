"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { extractYoutubeVideoId } from "@/lib/youtube";
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

export async function createTransitionProposal(formData: FormData) {
  const user = await requireUser();
  const fromInput = String(formData.get("fromVideo") ?? "");
  const toInput = String(formData.get("toVideo") ?? "");
  const endPrevRaw = String(formData.get("endPrevSec") ?? "");
  const startNextRaw = String(formData.get("startNextSec") ?? "");
  const presetIdRaw = String(formData.get("presetId") ?? "");
  const note = String(formData.get("note") ?? "");

  const fromVideo = extractYoutubeVideoId(fromInput);
  const toVideo = extractYoutubeVideoId(toInput);
  if (!fromVideo || !toVideo) throw new Error("Invalid YouTube IDs/URLs");

  const pairId = await findOrCreatePair(fromVideo, toVideo);
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.from("transition_proposals").insert({
    pair_id: pairId,
    proposed_by: user.id,
    end_prev_sec: endPrevRaw ? Math.max(0, Math.floor(Number(endPrevRaw))) : null,
    start_next_sec: startNextRaw ? Math.max(0, Math.floor(Number(startNextRaw))) : null,
    preset_id: presetIdRaw || null,
    note: note || null,
  });
  if (error) throw error;

  revalidatePath("/transition");
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
  return room.id as string;
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

  revalidatePath(`/rooms/${roomId}`);
}
