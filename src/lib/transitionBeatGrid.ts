/**
 * Align echo/stutter timing to the BPM-derived step grid (no new DB fields).
 * Anchor is snapped to the nearest multiple of `step`, then clamped so all seek
 * fire times stay before `endPrevSec`.
 */
export function snapEchoStutterAnchor(
  rawAnchor: number,
  step: number,
  endPrevSec: number,
  seekCount: number,
): number {
  if (!Number.isFinite(rawAnchor) || !Number.isFinite(endPrevSec)) return 0;
  if (step <= 0 || !Number.isFinite(step) || seekCount < 1) return Math.max(0, rawAnchor);

  const n = seekCount;
  const maxAnchor = Math.max(0, endPrevSec - (n - 1) * step - 1e-4);
  const snapped = Math.round(rawAnchor / step) * step;
  return Math.max(0, Math.min(snapped, maxAnchor));
}

/** Small lead so seek fires slightly before the ideal grid (YouTube seek latency). */
export const ECHO_STUTTER_SEEK_SLACK_SEC = 0.018;
