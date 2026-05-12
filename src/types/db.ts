import type { MediaRef } from "./media";

export type TransitionPreset = {
  id: string;
  code: string;
  label: string;
  description: string | null;
};

export type TransitionPair = {
  id: string;
  from_media: MediaRef;
  to_media: MediaRef;
  created_by: string;
  created_at: string;
};

export type TransitionProposal = {
  id: string;
  pair_id: string;
  proposed_by: string;
  end_prev_sec: number | null;
  start_next_sec: number | null;
  preset_id: string | null;
  prev_bpm: number | null;
  params: Record<string, unknown>;
  note: string | null;
  created_at: string;
};

export type ProposalWithVotes = TransitionProposal & {
  votes: number;
  preset?: TransitionPreset | null;
};

export type Room = {
  id: string;
  owner_id: string;
  title: string;
  slug: string;
  start_media: MediaRef;
  created_at: string;
  /** Popularity for directory sorting; incremented when someone opens the room. */
  play_count?: number;
};

export type RoomSetItem = {
  id: string;
  room_id: string;
  position: number;
  media: MediaRef;
  transition_pair_id_from_prev: string | null;
  best_proposal_id_from_prev: string | null;
  created_at: string;
};
