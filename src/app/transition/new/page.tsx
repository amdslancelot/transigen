import Link from "next/link";
import { lookupYoutubeMeta, voteProposal, type YoutubeMetaResult } from "@/app/actions";
import { DeleteProposalForm } from "@/components/DeleteProposalForm";
import { TransitionComposer } from "@/components/TransitionComposer";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { coerceProposalSeconds, formatMinSec } from "@/lib/timeInput";
import { extractYoutubeVideoId } from "@/lib/youtube";
import type { ProposalWithVotes, TransitionPreset } from "@/types/db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function fadeBarsLabel(params: Record<string, unknown> | null | undefined) {
  if (!params || typeof params !== "object") return null;
  const fb = (params as { fade_bars?: unknown }).fade_bars;
  const n = typeof fb === "number" ? fb : Number(fb);
  if (![1, 2, 4].includes(n)) return null;
  return `${n} bar${n === 1 ? "" : "s"} fade`;
}

export default async function TransitionNewPage(props: { searchParams: SearchParams }) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const fromVideoInput = String(searchParams.fromVideo ?? "");
  const toVideoInput = String(searchParams.toVideo ?? "");
  const fromVideo = extractYoutubeVideoId(fromVideoInput) ?? "";
  const toVideo = extractYoutubeVideoId(toVideoInput) ?? "";

  let prefetchedSongAMeta: Extract<YoutubeMetaResult, { ok: true }> | null = null;
  if (fromVideo && !toVideo && fromVideoInput.trim()) {
    const metaRes = await lookupYoutubeMeta(fromVideoInput.trim());
    if (metaRes.ok) prefetchedSongAMeta = metaRes;
  }

  const presets = await query<TransitionPreset>(
    `select id, code, label, description from transition_presets order by label`,
  );

  let proposals: ProposalWithVotes[] = [];
  if (fromVideo && toVideo) {
    const pairRows = await query<{ id: string }>(
      `select id from transition_pairs
       where from_media->>'provider' = 'youtube'
         and from_media->>'videoId' = $1
         and to_media->>'provider' = 'youtube'
         and to_media->>'videoId' = $2`,
      [fromVideo, toVideo],
    );
    const pair = pairRows[0];

    if (pair?.id) {
      const pRows = await query<ProposalWithVotes>(
        `select id, pair_id, proposed_by,
                end_prev_sec::float8 as end_prev_sec,
                start_next_sec::float8 as start_next_sec,
                preset_id,
                prev_bpm::float8 as prev_bpm,
                params, note,
                created_at::text as created_at
         from transition_proposals
         where pair_id = $1
         order by created_at asc`,
        [pair.id],
      );

      if (pRows.length > 0) {
        const votes = await query<{ proposal_id: string; user_id: string }>(
          `select proposal_id, user_id from transition_votes where proposal_id = any($1::uuid[])`,
          [pRows.map((r) => r.id)],
        );
        const grouped = new Map<string, number>();
        for (const vote of votes) {
          const current = grouped.get(vote.proposal_id) ?? 0;
          grouped.set(vote.proposal_id, current + 1);
        }
        proposals = pRows
          .map((row) => ({
            ...row,
            end_prev_sec: row.end_prev_sec != null ? coerceProposalSeconds(row.end_prev_sec) : null,
            start_next_sec: row.start_next_sec != null ? coerceProposalSeconds(row.start_next_sec) : null,
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
        <h1>New transition</h1>
        <div className="row">
          <Link className="pill" href="/transition">
            All transitions
          </Link>
          <Link className="pill" href="/">
            Home
          </Link>
          <Link className="pill" href="/room/new">
            Create room
          </Link>
        </div>
      </div>

      <TransitionComposer
        presets={presets}
        initialFrom={fromVideoInput}
        initialTo={toVideoInput}
        prefetchedSongAMeta={prefetchedSongAMeta}
      />

      <section className="panel col">
        <h2>Proposals (best first)</h2>
        {!fromVideo || !toVideo ? (
          <p className="muted">Enter Song A and Song B above to see proposals for this pair.</p>
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
                    A end: {formatMinSec(proposal.end_prev_sec)} / B start: {formatMinSec(proposal.start_next_sec)}
                  </span>
                  <span className="muted">
                    {proposal.preset?.label ?? "—"}
                    {proposal.prev_bpm != null ? ` · ${proposal.prev_bpm} BPM` : ""}
                    {(() => {
                      const fd = fadeBarsLabel(proposal.params as Record<string, unknown>);
                      return fd != null ? ` · ${fd}` : "";
                    })()}{" "}
                    {proposal.note ? `- ${proposal.note}` : ""}
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
                  {proposal.proposed_by === user.id ? <DeleteProposalForm proposalId={proposal.id} /> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
