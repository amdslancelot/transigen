"use client";

type Props = {
  /** Video id of the deck currently audible; null when no deck is loaded. */
  deckVideoId: string | null;
  /** Label for the audible deck ("deck A" during edges, "deck B" during the outro tail). */
  deckLabel: string;
  /** Current playback time of the audible deck, in seconds; null/undefined before playback starts. */
  deckSec: number | null | undefined;
  /** BPM of the outgoing track for the current edge; null when analysis is missing. */
  bpm: number | null;
  /** Upcoming transition description (preset code plus fade length); null when there is no edge. */
  nextLabel: string | null;
  /** Player phase as reported by RoomFullSetPlayer state. */
  phase: string;
};

/**
 * Honest telemetry strip pinned to the bottom edge (`.telemetry` in globals.css).
 * Every field is a raw reading passed in by the player; unknown values render as
 * "unknown" rather than a guess. Echo/stutter on the iframe player is a seekTo
 * simulation, so that field is a fixed "echo: simulated" disclosure.
 */
export function TelemetryStrip({ deckVideoId, deckLabel, deckSec, bpm, nextLabel, phase }: Props) {
  const fields = [
    `${deckLabel}: ${deckVideoId ?? "unknown"} t=${deckSec != null ? `${deckSec.toFixed(1)}s` : "unknown"}`,
    `bpm: ${bpm != null ? bpm.toFixed(1) : "unknown"}`,
    `next: ${nextLabel ?? "unknown"}`,
    "echo: simulated",
    `phase: ${phase}`,
  ];
  return <div className="telemetry">{fields.join(" | ")}</div>;
}
