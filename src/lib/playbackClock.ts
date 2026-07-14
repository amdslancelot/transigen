export type ClockSample = { wallMs: number; playerSec: number };

// Linear regression on recent samples. Returns estimated playerSec at given wallMs.
export function fitPlaybackClock(samples: ClockSample[]): (wallMs: number) => number {
  const n = samples.length;
  if (n < 2) return () => samples[n - 1]?.playerSec ?? 0;
  const sumX = samples.reduce((s, p) => s + p.wallMs, 0);
  const sumY = samples.reduce((s, p) => s + p.playerSec, 0);
  const sumXY = samples.reduce((s, p) => s + p.wallMs * p.playerSec, 0);
  const sumX2 = samples.reduce((s, p) => s + p.wallMs * p.wallMs, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return () => samples[n - 1].playerSec;
  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;
  return (wallMs: number) => m * wallMs + b;
}
