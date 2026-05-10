import Link from "next/link";
import { addRoomSong } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatSec } from "@/lib/youtube";
import { MediaPlayer } from "@/components/MediaPlayer";
import type { ProposalWithVotes, Room, RoomSetItem } from "@/types/db";

type Params = Promise<{ roomId: string }>;

function getEffectiveSeconds(
  durationSec: number,
  startNextSec: number | null | undefined,
  endPrevSec: number | null | undefined,
) {
  const start = Math.max(0, startNextSec ?? 0);
  const endTrim = Math.max(0, endPrevSec ?? 0);
  return Math.max(0, durationSec - start - endTrim);
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
  let proposalsById = new Map<string, ProposalWithVotes>();
  if (proposalIds.length > 0) {
    const { data: proposalsRaw } = await supabase
      .from("transition_proposals")
      .select("*")
      .in("id", proposalIds);
    const proposals = (proposalsRaw ?? []) as ProposalWithVotes[];
    proposalsById = new Map(proposals.map((p) => [p.id, { ...p, votes: 0 }]));
  }

  const totalSeconds = items.reduce((acc, item) => {
    const proposal = item.best_proposal_id_from_prev
      ? proposalsById.get(item.best_proposal_id_from_prev)
      : null;
    return acc + getEffectiveSeconds(item.media.durationSec ?? 240, proposal?.start_next_sec, proposal?.end_prev_sec);
  }, getEffectiveSeconds(typedRoom.start_media.durationSec ?? 240, 0, null));

  const overLimit = totalSeconds > 3600;
  const previousVideo =
    items.length > 0
      ? (items[items.length - 1].media.videoId ?? "")
      : (typedRoom.start_media.videoId ?? "");

  return (
    <main className="container col" style={{ gap: "1rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{typedRoom.title}</h1>
        <div className="row">
          <Link className="pill" href="/transition">
            Transition page
          </Link>
          <span className="pill">Set length {formatSec(totalSeconds)}</span>
          {overLimit ? <span className="pill" style={{ borderColor: "#ef4444" }}>Over 1 hour</span> : null}
        </div>
      </div>

      <section className="panel col">
        <h2>Playback</h2>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <MediaPlayer media={typedRoom.start_media} label="Room start song (A)" startAt={0} />
          </div>
          <div style={{ flex: 1 }}>
            {items.length > 0 ? (
              <MediaPlayer media={items[items.length - 1].media} label="Latest chained song" startAt={0} />
            ) : (
              <div className="panel">
                <p className="muted">Add songs to preview the set chain.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel col">
        <h2>Add next song</h2>
        <p className="muted">
          The app automatically links the best transition from previous song to new song, if available.
        </p>
        <form action={addRoomSong} className="row">
          <input type="hidden" name="roomId" value={roomId} />
          <input type="hidden" name="previousVideo" value={previousVideo} />
          <input
            name="nextSong"
            placeholder="YouTube URL or ID for next track"
            required
            style={{ minWidth: 320 }}
          />
          <button type="submit" disabled={overLimit}>
            Add song
          </button>
        </form>
        {overLimit ? <p className="muted">Remove/trim tracks to stay under 1 hour.</p> : null}
      </section>

      <section className="panel col">
        <h2>Set chain</h2>
        <div className="col">
          <div className="row">
            <strong>0.</strong>
            <span>Song A (start): {typedRoom.start_media.videoId}</span>
          </div>
          {items.map((item) => {
            const proposal = item.best_proposal_id_from_prev
              ? proposalsById.get(item.best_proposal_id_from_prev)
              : null;
            return (
              <div key={item.id} className="row" style={{ alignItems: "flex-start" }}>
                <strong>{item.position}.</strong>
                <div className="col">
                  <span>Song: {item.media.videoId}</span>
                  <span className="muted">
                    Transition: A end {formatSec(proposal?.end_prev_sec)} / B start{" "}
                    {formatSec(proposal?.start_next_sec)}
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
