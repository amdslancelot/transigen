import type { MediaRef } from "@/types/media";
import type { ProposalWithVotes, Room, RoomSetItem } from "@/types/db";
import { coerceProposalSeconds } from "@/lib/timeInput";

export type PlaybackEdge = {
  videoIdA: string;
  videoIdB: string;
  durationA: number | null;
  durationB: number | null;
  endPrevSec: number;
  startNextSec: number;
  presetCode: string;
  bpm: number | null;
  fadeBars: 1 | 2 | 4 | null;
};

type ProposalWithPresetRow = ProposalWithVotes & {
  transition_presets?: { code?: string } | null;
};

const DEFAULT_DUR = 240;

function parseFadeBars(params: Record<string, unknown>): 1 | 2 | 4 | null {
  const fb = params.fade_bars;
  const n = typeof fb === "number" ? fb : Number(fb);
  if (n === 1 || n === 2 || n === 4) return n;
  return null;
}

function presetCodeFromRow(row: ProposalWithPresetRow): string {
  const tp = row.transition_presets as { code?: string } | { code?: string }[] | null | undefined;
  if (Array.isArray(tp)) return tp[0]?.code ?? "hard_cut";
  return tp?.code ?? "hard_cut";
}

/** Supabase embed shape: `transition_presets` nested on proposal row */
export function buildRoomPlaybackEdges(
  room: Room,
  items: RoomSetItem[],
  proposalsById: Map<string, ProposalWithPresetRow>,
): PlaybackEdge[] {
  const edges: PlaybackEdge[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const pid = item.best_proposal_id_from_prev;
    if (!pid) continue;
    const prop = proposalsById.get(pid);
    if (!prop || prop.end_prev_sec == null || prop.start_next_sec == null) continue;

    const fromMedia: MediaRef = i === 0 ? room.start_media : items[i - 1].media;
    const fromVid = fromMedia.videoId;
    const toVid = item.media.videoId;
    if (!fromVid || !toVid) continue;

    const code = presetCodeFromRow(prop);
    const fadeBars = code === "fade" || code === "fade_like" ? parseFadeBars(prop.params ?? {}) : null;

    edges.push({
      videoIdA: fromVid,
      videoIdB: toVid,
      durationA: fromMedia.durationSec ?? null,
      durationB: item.media.durationSec ?? null,
      endPrevSec: coerceProposalSeconds(prop.end_prev_sec),
      startNextSec: coerceProposalSeconds(prop.start_next_sec),
      presetCode: code,
      bpm: prop.prev_bpm,
      fadeBars,
    });
  }
  return edges;
}

/** Wall-clock-ish set length from stored trim points (for 1h cap). */
export function computeRoomSetLengthSec(
  room: Room,
  items: RoomSetItem[],
  proposalsById: Map<string, ProposalWithPresetRow>,
): number {
  if (items.length === 0) {
    return room.start_media.durationSec ?? DEFAULT_DUR;
  }

  const p0 = items[0].best_proposal_id_from_prev
    ? proposalsById.get(items[0].best_proposal_id_from_prev)
    : null;
  const startDur = room.start_media.durationSec ?? DEFAULT_DUR;
  let acc = 0;
  const p0End = p0?.end_prev_sec != null ? coerceProposalSeconds(p0.end_prev_sec) : 0;
  if (p0End > 0) {
    acc += Math.min(p0End, startDur);
  } else {
    acc += startDur;
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const propThis = item.best_proposal_id_from_prev
      ? proposalsById.get(item.best_proposal_id_from_prev)
      : null;
    const next = items[i + 1];
    const propNext = next?.best_proposal_id_from_prev
      ? proposalsById.get(next.best_proposal_id_from_prev)
      : null;

    const dur = item.media.durationSec ?? DEFAULT_DUR;
    const start = Math.max(0, propThis?.start_next_sec != null ? coerceProposalSeconds(propThis.start_next_sec) : 0);
    const endPrevNext =
      propNext?.end_prev_sec != null ? coerceProposalSeconds(propNext.end_prev_sec) : 0;
    const end = endPrevNext > 0 ? Math.min(endPrevNext, dur) : dur;
    acc += Math.max(0, end - start);
  }

  return acc;
}
