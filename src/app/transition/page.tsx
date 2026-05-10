import Link from "next/link";
import { createTransitionProposal, voteProposal } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { extractYoutubeVideoId, formatSec } from "@/lib/youtube";
import { TransitionEditor } from "@/components/TransitionEditor";
import { TransitionPreview } from "@/components/TransitionPreview";
import type { ProposalWithVotes, TransitionPreset } from "@/types/db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TransitionPage(props: { searchParams: SearchParams }) {
  await requireUser();
  const searchParams = await props.searchParams;
  const fromVideoInput = String(searchParams.fromVideo ?? "");
  const toVideoInput = String(searchParams.toVideo ?? "");
  const fromVideo = extractYoutubeVideoId(fromVideoInput) ?? "";
  const toVideo = extractYoutubeVideoId(toVideoInput) ?? "";
  const endPrevSec = searchParams.endPrevSec ? Number(searchParams.endPrevSec) : null;
  const startNextSec = searchParams.startNextSec ? Number(searchParams.startNextSec) : null;

  const supabase = await getSupabaseServerClient();
  const { data: presetsRaw } = await supabase.from("transition_presets").select("*").order("label");
  const presets = (presetsRaw ?? []) as TransitionPreset[];

  let proposals: ProposalWithVotes[] = [];
  if (fromVideo && toVideo) {
    const { data: pair } = await supabase
      .from("transition_pairs")
      .select("id")
      .eq("from_media->>provider", "youtube")
      .eq("from_media->>videoId", fromVideo)
      .eq("to_media->>provider", "youtube")
      .eq("to_media->>videoId", toVideo)
      .maybeSingle();

    if (pair?.id) {
      const { data: rows } = await supabase
        .from("transition_proposals")
        .select("id,pair_id,proposed_by,end_prev_sec,start_next_sec,preset_id,note,created_at")
        .eq("pair_id", pair.id)
        .order("created_at", { ascending: true });

      const pRows = (rows ?? []) as ProposalWithVotes[];
      if (pRows.length > 0) {
        const { data: votes } = await supabase
          .from("transition_votes")
          .select("proposal_id,user_id")
          .in(
            "proposal_id",
            pRows.map((r) => r.id),
          );
        const grouped = new Map<string, number>();
        for (const vote of votes ?? []) {
          const current = grouped.get(vote.proposal_id as string) ?? 0;
          grouped.set(vote.proposal_id as string, current + 1);
        }
        proposals = pRows
          .map((row) => ({
            ...row,
            votes: grouped.get(row.id) ?? 0,
            preset: presets.find((p) => p.id === row.preset_id) ?? null,
          }))
          .sort((a, b) => (b.votes === a.votes ? a.created_at.localeCompare(b.created_at) : b.votes - a.votes));
      }
    }
  }

  return (
    <main className="container col" style={{ gap: "1rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Transition</h1>
        <div className="row">
          <Link className="pill" href="/">
            Home
          </Link>
          <Link className="pill" href="/rooms/new">
            Create room
          </Link>
        </div>
      </div>

      <section className="panel col">
        <h2>Pick a song pair (A→B)</h2>
        <form className="col" action="/transition" method="get">
          <div className="row">
            <div className="col" style={{ flex: 1 }}>
              <label htmlFor="fromVideo">Song A YouTube URL/ID</label>
              <input id="fromVideo" name="fromVideo" defaultValue={fromVideoInput} required />
            </div>
            <div className="col" style={{ flex: 1 }}>
              <label htmlFor="toVideo">Song B YouTube URL/ID</label>
              <input id="toVideo" name="toVideo" defaultValue={toVideoInput} required />
            </div>
          </div>
          <div className="row">
            <div className="col">
              <label htmlFor="endPrevSec">Preview switch time on A (sec)</label>
              <input id="endPrevSec" name="endPrevSec" type="number" min={0} defaultValue={endPrevSec ?? ""} />
            </div>
            <div className="col">
              <label htmlFor="startNextSec">Preview start time on B (sec)</label>
              <input
                id="startNextSec"
                name="startNextSec"
                type="number"
                min={0}
                defaultValue={startNextSec ?? ""}
              />
            </div>
          </div>
          <div className="row">
            <button type="submit">Load pair + preview</button>
          </div>
        </form>
      </section>

      <section className="panel col">
        <h2>Preview A→B cutover</h2>
        <TransitionPreview
          fromInput={fromVideo}
          toInput={toVideo}
          endPrevSec={endPrevSec}
          startNextSec={startNextSec}
        />
      </section>

      <section className="panel col">
        <h2>Propose a transition</h2>
        <form action={createTransitionProposal} className="col">
          <input type="hidden" name="fromVideo" value={fromVideo} />
          <input type="hidden" name="toVideo" value={toVideo} />
          <TransitionEditor presets={presets} />
          <div className="row">
            <button type="submit" disabled={!fromVideo || !toVideo}>
              Save proposal
            </button>
          </div>
        </form>
      </section>

      <section className="panel col">
        <h2>Proposals (best first)</h2>
        {!fromVideo || !toVideo ? (
          <p className="muted">Pick Song A and Song B first.</p>
        ) : proposals.length === 0 ? (
          <p className="muted">No proposals yet for this pair.</p>
        ) : (
          <div className="col">
            {proposals.map((proposal, idx) => (
              <div
                key={proposal.id}
                className="row"
                style={{ justifyContent: "space-between", borderBottom: "1px solid #2a2f3a", padding: "0.5rem 0" }}
              >
                <div className="col" style={{ flex: 1 }}>
                  <div className="row">
                    {idx === 0 ? <span className="pill">Best</span> : null}
                    <span className="muted">By {proposal.proposed_by.slice(0, 8)}</span>
                  </div>
                  <span>
                    A end: {formatSec(proposal.end_prev_sec)} / B start: {formatSec(proposal.start_next_sec)}
                  </span>
                  <span className="muted">
                    {proposal.preset?.label ?? "No preset"} {proposal.note ? `- ${proposal.note}` : ""}
                  </span>
                </div>
                <div className="row">
                  <span className="pill">{proposal.votes} votes</span>
                  <form action={voteProposal}>
                    <input type="hidden" name="proposalId" value={proposal.id} />
                    <button type="submit">Vote</button>
                  </form>
                  <form action={voteProposal}>
                    <input type="hidden" name="proposalId" value={proposal.id} />
                    <input type="hidden" name="mode" value="remove" />
                    <button type="submit" className="secondary">
                      Unvote
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
