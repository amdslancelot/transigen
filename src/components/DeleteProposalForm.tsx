"use client";

import { deleteTransitionProposal } from "@/app/actions";

export function DeleteProposalForm({ proposalId }: { proposalId: string }) {
  return (
    <form
      action={deleteTransitionProposal}
      onSubmit={(e) => {
        if (!confirm("Delete this proposal?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="proposalId" value={proposalId} />
      <button type="submit" className="secondary">
        Delete
      </button>
    </form>
  );
}
