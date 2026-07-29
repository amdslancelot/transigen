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

/** Turn a preset code like "stutter_4" into a human label ("stutter · 4 bars"). */
function formatPresetLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const parts = code.split("_");
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^\d+$/.test(last)) {
    const n = Number(last);
    return `${parts.slice(0, -1).join(" ")} · ${n} ${n === 1 ? "bar" : "bars"}`;
  }
  return parts.join(" ");
}

/* Set list entries render as catalog cards; the transition between two tracks
 * renders as a slim "seam" connector between the cards (the seam is the work). */
const setListCardStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "2.1rem minmax(0, 1fr)",
  alignItems: "baseline",
  background: "#fdfbf6",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "0.5rem 0.65rem",
};

const setListNumStyle: React.CSSProperties = {
  fontFamily: "var(--font-display), Georgia, serif",
  fontSize: "1.05rem",
  color: "var(--muted)",
  fontVariantNumeric: "tabular-nums",
};

const seamStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.15rem 0 0.15rem 2.75rem",
  fontSize: "0.72rem",
};

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
    <main className="container col page-enter" style={{ gap: "0.75rem" }}>
      <RoomPlayIncrement roomId={roomId} />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        {typedRoom.owner_id === user.id ? (
          <RoomTitleBar roomId={roomId} initialTitle={typedRoom.title} />
        ) : (
          <h1 style={{ margin: 0 }}>{typedRoom.title}</h1>
        )}
        <div className="row" style={{ gap: "0.5rem" }}>
          <span className="pill">Set length {formatSec(totalSeconds)}</span>
          {overLimit ? <span className="pill" style={{ borderColor: "var(--danger)" }}>Over 1 hour</span> : null}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 380px)",
          gap: "0.75rem",
          alignItems: "start",
        }}
      >
        <section className="panel col">
          <h2 className="wall-label">Full set playback</h2>
          <TrackIngestStatus videoIds={allVideoIds} />
          <RoomFullSetPlayer edges={playbackEdges} startVideoId={startVid} />
        </section>

        <div className="col" style={{ gap: "0.75rem", minWidth: 0 }}>
          <section className="panel col">
            <h2 className="wall-label">Set List</h2>
            <div
              className="col"
              style={{ overflowY: "auto", maxHeight: "max(200px, calc(100vh - 460px))", gap: "0.6rem" }}
            >
              <div style={setListCardStyle}>
                <span style={setListNumStyle}>1</span>
                <div className="col" style={{ gap: "0.1rem", minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{formatArtistTrack(trackMetaById.get(startVid), startVid)}</span>
                  <span className="muted" style={{ fontSize: "0.72rem" }}>opens the set</span>
                </div>
              </div>
              {items.map((item) => {
                const proposal = item.best_proposal_id_from_prev
                  ? proposalsById.get(item.best_proposal_id_from_prev)
                  : null;
                const presetLabel = formatPresetLabel(proposal?.transition_presets?.code);
                const vid = item.media.videoId ?? "";
                return (
                  <div key={item.id} className="col" style={{ gap: "0.2rem" }}>
                    <div className="muted" style={seamStyle}>
                      <span style={{ whiteSpace: "nowrap" }}>
                        out {formatMinSec(proposal?.end_prev_sec)} → in {formatMinSec(proposal?.start_next_sec)}
                      </span>
                      {presetLabel ? (
                        <span className="pill" style={{ fontSize: "0.66rem", padding: "0.05rem 0.45rem" }}>
                          {presetLabel}
                        </span>
                      ) : null}
                      <span aria-hidden style={{ flex: 1, borderBottom: "1px dashed var(--border)" }} />
                    </div>
                    <div style={setListCardStyle}>
                      <span style={setListNumStyle}>{item.position + 1}</span>
                      <div className="col" style={{ gap: "0.1rem", minWidth: 0 }}>
                        <span style={{ fontWeight: 500 }}>{formatArtistTrack(trackMetaById.get(vid), vid)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel col">
            <h2 className="wall-label">extend the set</h2>
            <RoomChainPicker
              roomId={roomId}
              extendFromVideoId={extendFromVideoId}
              overLimit={overLimit}
              initialTrackLabels={initialTrackLabels}
            />
            {overLimit ? <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>set is at the one-hour cap</p> : null}
          </section>
        </div>
      </div>
    </main>
  );
}
