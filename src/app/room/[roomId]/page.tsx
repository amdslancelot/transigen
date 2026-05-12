import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { buildRoomPlaybackEdges, computeRoomSetLengthSec } from "@/lib/roomPlaybackEdges";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { coerceProposalSeconds, formatMinSec } from "@/lib/timeInput";
import { formatSec } from "@/lib/youtube";
import { RoomChainPicker } from "@/components/RoomChainPicker";
import { RoomFullSetPlayer } from "@/components/RoomFullSetPlayer";
import { RoomPlayIncrement } from "@/components/RoomPlayIncrement";
import { RoomTitleBar } from "@/components/RoomTitleBar";
import type { ProposalWithVotes, Room, RoomSetItem, TransitionProposal } from "@/types/db";

type Params = Promise<{ roomId: string }>;

type ProposalWithPresetRow = ProposalWithVotes & {
  transition_presets?: { code?: string } | null;
};

function normalizeProposalRow(raw: unknown): ProposalWithPresetRow {
  const r = raw as Record<string, unknown>;
  const tp = r.transition_presets;
  const presetObj = Array.isArray(tp)
    ? ((tp[0] as { code?: string } | undefined) ?? null)
    : ((tp as { code?: string } | null | undefined) ?? null);
  const base = r as TransitionProposal;
  const endPrev = base.end_prev_sec != null ? coerceProposalSeconds(base.end_prev_sec) : null;
  const startNext = base.start_next_sec != null ? coerceProposalSeconds(base.start_next_sec) : null;
  return {
    ...base,
    end_prev_sec: endPrev,
    start_next_sec: startNext,
    votes: 0,
    transition_presets: presetObj,
  };
}

type YoutubeListMeta = { title: string; channelTitle: string };

function formatArtistTrack(meta: YoutubeListMeta | undefined, videoId: string): string {
  const title = meta?.title?.trim() ?? "";
  const ch = meta?.channelTitle?.trim() ?? "";
  if (ch && title) return `${ch} - ${title}`;
  if (title) return title;
  return videoId;
}

export default async function RoomPage(props: { params: Params }) {
  const user = await requireUser();
  const { roomId } = await props.params;
  const supabase = await getSupabaseServerClient();

  const { data: room } = await supabase.from("rooms").select("*").eq("id", roomId).single();
  const typedRoom = room as Room | null;

  if (!typedRoom) {
    return (
      <main className="container">
        <p>Room not found.</p>
      </main>
    );
  }

  await supabase.from("room_members").upsert({ room_id: roomId, user_id: user.id });

  const { data: itemsRaw } = await supabase
    .from("room_set_items")
    .select("*")
    .eq("room_id", roomId)
    .order("position", { ascending: true });
  const items = (itemsRaw ?? []) as RoomSetItem[];

  const proposalIds = items
    .map((i) => i.best_proposal_id_from_prev)
    .filter((id): id is string => typeof id === "string");
  let proposalsById = new Map<string, ProposalWithPresetRow>();
  if (proposalIds.length > 0) {
    const { data: proposalsRaw } = await supabase
      .from("transition_proposals")
      .select(
        "id,pair_id,proposed_by,end_prev_sec,start_next_sec,preset_id,prev_bpm,params,note,created_at,transition_presets(code)",
      )
      .in("id", proposalIds);
    const proposals = (proposalsRaw ?? []).map(normalizeProposalRow);
    proposalsById = new Map(proposals.map((p) => [p.id, p]));
  }

  const totalSeconds = computeRoomSetLengthSec(typedRoom, items, proposalsById);
  const overLimit = totalSeconds > 3600;
  const extendFromVideoId =
    items.length > 0 ? (items[items.length - 1].media.videoId ?? "") : (typedRoom.start_media.videoId ?? "");

  const playbackEdges = buildRoomPlaybackEdges(typedRoom, items, proposalsById);

  const startVid = typedRoom.start_media.videoId ?? "";
  const itemVids = items.map((i) => i.media.videoId).filter((v): v is string => typeof v === "string" && v.length > 0);
  const allVideoIds = Array.from(new Set([startVid, ...itemVids].filter((id) => id.length > 0)));

  const trackMetaById = new Map<string, YoutubeListMeta>();
  if (allVideoIds.length > 0) {
    const { data: cacheRows } = await supabase
      .from("youtube_video_cache")
      .select("video_id,title,channel_title")
      .in("video_id", allVideoIds);
    for (const row of cacheRows ?? []) {
      const id = String(row.video_id ?? "");
      if (!id) continue;
      trackMetaById.set(id, {
        title: (row.title as string) ?? "",
        channelTitle: (row.channel_title as string) ?? "",
      });
    }
  }

  const initialTrackLabels: Record<string, string> = {};
  for (const [id, meta] of trackMetaById) {
    initialTrackLabels[id] = formatArtistTrack(meta, id);
  }

  return (
    <main className="container col" style={{ gap: "1rem" }}>
      <RoomPlayIncrement roomId={roomId} />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
        {typedRoom.owner_id === user.id ? (
          <RoomTitleBar roomId={roomId} initialTitle={typedRoom.title} />
        ) : (
          <h1 style={{ margin: 0 }}>{typedRoom.title}</h1>
        )}
        <div className="row">
          <Link className="pill" href="/room">
            All rooms
          </Link>
          <Link className="pill" href="/transition">
            Transition page
          </Link>
          <span className="pill">Set length {formatSec(totalSeconds)}</span>
          {overLimit ? <span className="pill" style={{ borderColor: "#ef4444" }}>Over 1 hour</span> : null}
        </div>
      </div>

      <section className="panel col">
        <h2>Full set playback</h2>
        <p className="muted">
          The room start track is preloaded on Player 1. After you add songs from saved transitions below, this
          section plays the whole chain with each transition&apos;s preset (fade / echo / stutter).
        </p>
        <RoomFullSetPlayer edges={playbackEdges} startVideoId={startVid} />
      </section>

      <section className="panel col">
        <h2>Extend set from saved transitions</h2>
        <RoomChainPicker
          roomId={roomId}
          extendFromVideoId={extendFromVideoId}
          overLimit={overLimit}
          initialTrackLabels={initialTrackLabels}
        />
        {overLimit ? <p className="muted">Set is at the 1 hour cap; trim before adding more.</p> : null}
      </section>

      <section className="panel col">
        <h2>Set List</h2>
        <div className="col">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <strong>0.</strong>
            <div className="col">
              <span>{formatArtistTrack(trackMetaById.get(startVid), startVid)}</span>
              <span className="muted">YouTube: {startVid || "—"}</span>
            </div>
          </div>
          {items.map((item) => {
            const proposal = item.best_proposal_id_from_prev
              ? proposalsById.get(item.best_proposal_id_from_prev)
              : null;
            const presetCode = proposal?.transition_presets?.code ?? "—";
            const vid = item.media.videoId ?? "";
            return (
              <div key={item.id} className="row" style={{ alignItems: "flex-start" }}>
                <strong>{item.position}.</strong>
                <div className="col">
                  <span>{formatArtistTrack(trackMetaById.get(vid), vid)}</span>
                  <span className="muted">
                    A end {formatMinSec(proposal?.end_prev_sec)} / B start {formatMinSec(proposal?.start_next_sec)} · preset{" "}
                    {presetCode} · {vid}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
