import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { query as sql } from "@/lib/db";
import { formatPresetLabelShort } from "@/lib/presetLabel";
import { computeRoomSetLengthSec } from "@/lib/roomPlaybackEdges";
import { formatSec } from "@/lib/youtube";
import type { ProposalWithVotes, Room, RoomSetItem, TransitionProposal } from "@/types/db";

const PAGE_SIZE = 10;

/* At most this many transition-preset pills per row; the rest collapse to "+n". */
const PRESET_PILL_LIMIT = 5;

const monoFont = "ui-monospace, SFMono-Regular, Menlo, monospace";

type Params = Promise<{ q?: string; page?: string }>;

type DirectoryRow = Pick<Room, "id" | "owner_id" | "title" | "slug" | "start_media" | "created_at"> & {
  play_count: number;
};

type ProposalWithPresetRow = ProposalWithVotes & {
  transition_presets?: { code?: string } | null;
};

/* Everything a row needs to whisper what the set inside looks like. */
type RoomPreview = {
  startLabel: string;
  endLabel: string | null;
  presetLabels: string[];
  presetOverflow: number;
  trackCount: number;
  lengthSec: number | null;
  bpmMin: number | null;
  bpmMax: number | null;
};

/** Cached title if we have one, else the raw videoId, else whatever the media ref carries. */
function trackLabel(videoId: string, titleByVideoId: Map<string, string>, fallbackTitle?: string): string {
  return titleByVideoId.get(videoId) ?? (videoId || fallbackTitle?.trim() || "unknown track");
}

function buildRoomPreview(
  room: DirectoryRow,
  items: RoomSetItem[],
  proposalsById: Map<string, ProposalWithPresetRow>,
  titleByVideoId: Map<string, string>,
  bpmByVideoId: Map<string, number>,
): RoomPreview {
  const startVid = room.start_media.videoId ?? "";
  const startLabel = trackLabel(startVid, titleByVideoId, room.start_media.title);

  if (items.length === 0) {
    /* A room with only its start track: just "starts …" and "1 track". */
    return {
      startLabel,
      endLabel: null,
      presetLabels: [],
      presetOverflow: 0,
      trackCount: 1,
      lengthSec: null,
      bpmMin: null,
      bpmMax: null,
    };
  }

  const lastItem = items[items.length - 1];
  const endLabel = trackLabel(lastItem.media.videoId ?? "", titleByVideoId, lastItem.media.title);

  const allPresetLabels: string[] = [];
  for (const item of items) {
    const proposal = item.best_proposal_id_from_prev ? proposalsById.get(item.best_proposal_id_from_prev) : null;
    const label = formatPresetLabelShort(proposal?.transition_presets?.code);
    if (label) allPresetLabels.push(label);
  }

  const bpms = [startVid, ...items.map((i) => i.media.videoId ?? "")]
    .map((vid) => bpmByVideoId.get(vid))
    .filter((bpm): bpm is number => bpm != null);

  return {
    startLabel,
    endLabel,
    presetLabels: allPresetLabels.slice(0, PRESET_PILL_LIMIT),
    presetOverflow: Math.max(0, allPresetLabels.length - PRESET_PILL_LIMIT),
    trackCount: items.length + 1,
    lengthSec: computeRoomSetLengthSec(room, items, proposalsById),
    bpmMin: bpms.length > 0 ? Math.round(Math.min(...bpms)) : null,
    bpmMax: bpms.length > 0 ? Math.round(Math.max(...bpms)) : null,
  };
}

/**
 * Batch-load set previews for every room on the current page.
 * Query count is fixed (at most 4) regardless of how many rooms are shown.
 */
async function loadRoomPreviews(rooms: DirectoryRow[]): Promise<Map<string, RoomPreview>> {
  const previews = new Map<string, RoomPreview>();
  if (rooms.length === 0) return previews;

  const roomIds = rooms.map((r) => r.id);

  const itemRows = await sql<RoomSetItem>(
    `select id, room_id, position, media, transition_pair_id_from_prev,
            best_proposal_id_from_prev, created_at::text as created_at
     from room_set_items
     where room_id = any($1::uuid[])
     order by room_id, position asc`,
    [roomIds],
  );
  const itemsByRoom = new Map<string, RoomSetItem[]>();
  for (const item of itemRows) {
    const list = itemsByRoom.get(item.room_id);
    if (list) list.push(item);
    else itemsByRoom.set(item.room_id, [item]);
  }

  const proposalIds = Array.from(
    new Set(
      itemRows.map((i) => i.best_proposal_id_from_prev).filter((id): id is string => typeof id === "string"),
    ),
  );
  const videoIds = Array.from(
    new Set(
      [...rooms.map((r) => r.start_media.videoId), ...itemRows.map((i) => i.media.videoId)].filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      ),
    ),
  );

  const [proposalRows, cacheRows, analysisRows] = await Promise.all([
    proposalIds.length > 0
      ? sql<TransitionProposal & { preset_code: string | null }>(
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
        )
      : Promise.resolve([]),
    videoIds.length > 0
      ? sql<{ video_id: string; title: string | null }>(
          `select video_id, title from youtube_video_cache where video_id = any($1::text[])`,
          [videoIds],
        )
      : Promise.resolve([]),
    videoIds.length > 0
      ? sql<{ video_id: string; bpm: number | null }>(
          `select video_id, bpm::float8 as bpm from track_analysis where video_id = any($1::text[])`,
          [videoIds],
        )
      : Promise.resolve([]),
  ]);

  const proposalsById = new Map<string, ProposalWithPresetRow>();
  for (const { preset_code, ...row } of proposalRows) {
    proposalsById.set(row.id, {
      ...row,
      votes: 0,
      transition_presets: preset_code ? { code: preset_code } : null,
    });
  }

  const titleByVideoId = new Map<string, string>();
  for (const row of cacheRows) {
    const title = row.title?.trim();
    if (title) titleByVideoId.set(row.video_id, title);
  }

  const bpmByVideoId = new Map<string, number>();
  for (const row of analysisRows) {
    const bpm = row.bpm != null ? Number(row.bpm) : NaN;
    if (Number.isFinite(bpm) && bpm > 0) bpmByVideoId.set(row.video_id, bpm);
  }

  for (const room of rooms) {
    previews.set(
      room.id,
      buildRoomPreview(room, itemsByRoom.get(room.id) ?? [], proposalsById, titleByVideoId, bpmByVideoId),
    );
  }
  return previews;
}

function parseTotalCount(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function buildRoomsHref(q: string, page: number): string {
  const p = new URLSearchParams();
  const t = q.trim();
  if (t) p.set("q", t);
  if (page > 0) p.set("page", String(page));
  const s = p.toString();
  return s ? `/room?${s}` : "/room";
}

export default async function RoomsIndexPage(props: { searchParams: Params }) {
  await requireUser();
  const sp = await props.searchParams;
  const query = (sp.q ?? "").trim();
  const page = Math.max(0, parseInt(sp.page ?? "0", 10) || 0);
  const offset = page * PAGE_SIZE;

  let rooms: DirectoryRow[] = [];
  let total = 0;
  let listErrMsg: string | undefined;
  try {
    const [rows, countRows] = await Promise.all([
      sql<DirectoryRow>(
        `select id, owner_id, title, slug, start_media, created_at::text as created_at, play_count
         from list_rooms_directory($1, $2, $3)`,
        [query, PAGE_SIZE, offset],
      ),
      sql<{ count: unknown }>(`select count_rooms_directory($1) as count`, [query]),
    ]);
    rooms = rows;
    total = parseTotalCount(countRows[0]?.count);
  } catch (e: unknown) {
    listErrMsg = e instanceof Error ? e.message : "Failed to load rooms.";
  }

  /* Set previews are decorative; if they fail to load, the list still renders. */
  let previewByRoomId = new Map<string, RoomPreview>();
  try {
    previewByRoomId = await loadRoomPreviews(rooms);
  } catch {
    previewByRoomId = new Map();
  }

  const hasPrev = page > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <main className="container col" style={{ gap: "0.75rem", paddingTop: "0.5rem" }}>
      <h1 style={{ margin: 0 }}>Rooms</h1>

      <section className="col" style={{ gap: "0.625rem" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap" }}>
          <h2 className="wall-label" style={{ margin: "0 0 0.25rem" }}>Popular rooms</h2>
          <span className="muted">
            {query ? `Search "${query}" · ` : null}
            {total} total · Page {page + 1}
          </span>
        </div>

        <div className="row" style={{ gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <form action="/room" method="get" className="row" style={{ gap: "0.5rem", flexWrap: "nowrap" }}>
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search by track title…"
              aria-label="Search rooms by track title"
              style={{ width: "min(100%, 260px)" }}
            />
            <button type="submit">Search</button>
            {query ? (
              <Link className="pill" href="/room" style={{ borderColor: "var(--surface-2)", background: "var(--surface-2)" }}>
                Clear
              </Link>
            ) : null}
          </form>
          <Link
            href="/room/new"
            className="empty-slot"
            aria-label="Create a room"
            style={{ width: 180, minHeight: "2.1rem" }}
          />
        </div>

        {listErrMsg ? (
          <p style={{ color: "var(--danger)" }}>
            Could not load the room list: {listErrMsg}. If the database migrations have not been applied yet, run{" "}
            <code>npm run migrate</code>.
          </p>
        ) : rooms.length === 0 ? (
          <p className="muted">{query ? "No rooms match that track title." : "No rooms yet — create the first one."}</p>
        ) : (
          <div style={{ columnCount: 2, columnGap: "2.5rem" }}>
            {rooms.map((room) => {
              const plays = room.play_count ?? 0;
              const preview = previewByRoomId.get(room.id);
              return (
                <Link
                  key={room.id}
                  href={`/room/${room.id}`}
                  className="rule-row frost"
                  style={{ breakInside: "avoid", padding: "0.7rem 0.85rem", marginBottom: "0.75rem", borderBottom: "1px solid color-mix(in srgb, var(--border) 65%, transparent)" }}
                >
                  <div className="rule-row-title">{room.title}</div>
                  <span className="muted" style={{ fontSize: "0.85rem", lineHeight: 1.3 }}>
                    {plays} plays · {room.slug}
                  </span>
                  {preview ? (
                    <div className="col muted" style={{ gap: "0.25rem", marginTop: "0.3rem" }}>
                      <span style={{ fontSize: "0.78rem", lineHeight: 1.35 }}>
                        starts {preview.startLabel}
                        {preview.endLabel != null ? <> → ends {preview.endLabel}</> : null}
                      </span>
                      {preview.presetLabels.length > 0 ? (
                        <span className="row" style={{ gap: "0.3rem", flexWrap: "wrap", alignItems: "center" }}>
                          {preview.presetLabels.map((label, i) => (
                            <span key={i} className="pill" style={{ fontSize: "0.66rem", padding: "0.05rem 0.45rem" }}>
                              {label}
                            </span>
                          ))}
                          {preview.presetOverflow > 0 ? (
                            <span style={{ fontSize: "0.66rem" }}>+{preview.presetOverflow}</span>
                          ) : null}
                        </span>
                      ) : null}
                      <span style={{ fontFamily: monoFont, fontSize: "0.68rem" }}>
                        {preview.trackCount} {preview.trackCount === 1 ? "track" : "tracks"}
                        {preview.lengthSec != null ? <> · {formatSec(preview.lengthSec)}</> : null}
                        {preview.bpmMin != null && preview.bpmMax != null ? (
                          <>
                            {" "}
                            · {preview.bpmMin === preview.bpmMax
                              ? `${preview.bpmMin} bpm`
                              : `${preview.bpmMin}–${preview.bpmMax} bpm`}
                          </>
                        ) : null}
                      </span>
                    </div>
                  ) : null}
                </Link>
              );
            })}
          </div>
        )}

        {!listErrMsg && total > PAGE_SIZE ? (
          <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
            {hasPrev ? (
              <Link className="pill" href={buildRoomsHref(query, page - 1)} style={{ borderColor: "var(--surface-2)", background: "var(--surface-2)" }}>
                Previous {PAGE_SIZE}
              </Link>
            ) : (
              <span className="pill muted" style={{ opacity: 0.45 }}>
                Previous {PAGE_SIZE}
              </span>
            )}
            {hasNext ? (
              <Link className="pill" href={buildRoomsHref(query, page + 1)}>
                Next {PAGE_SIZE}
              </Link>
            ) : (
              <span className="pill muted" style={{ opacity: 0.45 }}>
                Next {PAGE_SIZE}
              </span>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
