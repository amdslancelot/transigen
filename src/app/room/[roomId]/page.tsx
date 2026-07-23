import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildRoomPlaybackEdges, computeRoomSetLengthSec } from "@/lib/roomPlaybackEdges";
import { coerceProposalSeconds, formatMinSec } from "@/lib/timeInput";
import { isUuid } from "@/lib/validate";
import { formatSec } from "@/lib/youtube";
import { RoomChainPicker } from "@/components/RoomChainPicker";
import { RoomFullSetPlayer } from "@/components/RoomFullSetPlayer";
import { TrackIngestStatus } from "@/components/TrackIngestStatus";
import { RoomPlayIncrement } from "@/components/RoomPlayIncrement";
import { RoomTitleBar } from "@/components/RoomTitleBar";
import type { ProposalWithVotes, Room, RoomSetItem, TransitionProposal } from "@/types/db";
import { triggerIngest } from "@/app/actions";

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

  const roomRows = isUuid(roomId)
    ? await query<Room>(
        `select id, owner_id, title, slug, start_media, play_count, created_at::text as created_at
         from rooms where id = $1`,
        [roomId],
      )
    : [];
  const typedRoom = roomRows[0] ?? null;

  if (!typedRoom) {
    return (
      <main className="container">
        <p>Room not found.</p>
      </main>
    );
  }

  await query(
    `insert into room_members (room_id, user_id) values ($1, $2) on conflict do nothing`,
    [roomId, user.id],
  );

  const items = await query<RoomSetItem>(
    `select id, room_id, position, media, transition_pair_id_from_prev,
            best_proposal_id_from_prev, created_at::text as created_at
     from room_set_items
     where room_id = $1
     order by position asc`,
    [roomId],
  );

  const proposalIds = items
    .map((i) => i.best_proposal_id_from_prev)
    .filter((id): id is string => typeof id === "string");
  let proposalsById = new Map<string, ProposalWithPresetRow>();
  if (proposalIds.length > 0) {
    const proposalsRaw = await query<TransitionProposal & { preset_code: string | null }>(
      `select tp.id, tp.pair_id, tp.proposed_by,
              tp.end_prev_sec::float8 as end_prev_sec,
              tp.start_next_sec::float8 as start_next_sec,
              tp.preset_id,
              tp.prev_bpm::float8 as prev_bpm,
              tp.params, tp.note,
              tp.created_at::text as created_at,
              pr.code as preset_code
       from transition_proposals tp
       left join transition_presets pr on pr.id = tp.preset_id
       where tp.id = any($1::uuid[])`,
      [proposalIds],
    );
    const proposals = proposalsRaw.map(({ preset_code, ...row }) =>
      normalizeProposalRow({
        ...row,
        transition_presets: preset_code ? { code: preset_code } : null,
      }),
    );
    proposalsById = new Map(proposals.map((p) => [p.id, p]));
  }

  const totalSeconds = computeRoomSetLengthSec(typedRoom, items, proposalsById);
  const overLimit = totalSeconds > 3600;
  const extendFromVideoId =
    items.length > 0 ? (items[items.length - 1].media.videoId ?? "") : (typedRoom.start_media.videoId ?? "");

  const startVid = typedRoom.start_media.videoId ?? "";
  const itemVids = items.map((i) => i.media.videoId).filter((v): v is string => typeof v === "string" && v.length > 0);
  const allVideoIds = Array.from(new Set([startVid, ...itemVids].filter((id) => id.length > 0)));

  if (allVideoIds.length > 0) {
    await triggerIngest(allVideoIds);
  }

  const trackAnalysisMap = new Map<string, { bpm: number; beat_offset: number }>();
  if (allVideoIds.length > 0) {
    const analysisRows = await query<{ video_id: string; bpm: number | null; beat_offset: number | null }>(
      `select video_id, bpm, beat_offset from track_analysis where video_id = any($1::text[])`,
      [allVideoIds],
    );
    for (const row of analysisRows) {
      if (row.video_id && row.bpm != null) {
        trackAnalysisMap.set(row.video_id, { bpm: Number(row.bpm), beat_offset: Number(row.beat_offset ?? 0) });
      }
    }
  }

  const playbackEdges = buildRoomPlaybackEdges(typedRoom, items, proposalsById, trackAnalysisMap);

  const trackMetaById = new Map<string, YoutubeListMeta>();
  if (allVideoIds.length > 0) {
    const cacheRows = await query<{ video_id: string; title: string | null; channel_title: string | null }>(
      `select video_id, title, channel_title from youtube_video_cache where video_id = any($1::text[])`,
      [allVideoIds],
    );
    for (const row of cacheRows) {
      trackMetaById.set(row.video_id, {
        title: row.title ?? "",
        channelTitle: row.channel_title ?? "",
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
        <TrackIngestStatus videoIds={allVideoIds} />
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
