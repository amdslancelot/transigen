/** Stored / displayed precision for proposal trim times (seconds fractional part). */
export const PROPOSAL_TIME_DECIMALS = 3;

export function roundProposalSeconds(sec: number): number {
  const f = 10 ** PROPOSAL_TIME_DECIMALS;
  return Math.round(sec * f) / f;
}

/**
 * Parse `m:s` or `m:s.fff` (minutes : seconds, seconds may be fractional).
 * Seconds part may exceed 59 (treated as `minutes*60 + seconds`).
 * Also accepts legacy plain seconds, e.g. `90.5`.
 */
export function parseProposalTime(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.includes(":")) {
    const idx = t.indexOf(":");
    const minPart = t.slice(0, idx).trim();
    const secPart = t.slice(idx + 1).trim();
    if (secPart === "") return null;
    const minutes = Number(minPart);
    const seconds = Number(secPart);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (minutes < 0 || seconds < 0) return null;
    if (minutes > 99999) return null;
    return roundProposalSeconds(minutes * 60 + seconds);
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundProposalSeconds(n);
}

/** Display seconds as `m:ss` or `m:ss.fff` (trim trailing zeros in fractional part). */
export function formatMinSec(sec: number | null | undefined): string {
  if (sec == null || Number.isNaN(sec)) return "--:--";
  const rounded = roundProposalSeconds(Number(sec));
  if (rounded < 0) return "--:--";
  const m = Math.floor(rounded / 60);
  const s = rounded - m * 60;
  const sFixed = s.toFixed(PROPOSAL_TIME_DECIMALS);
  const trimmed = sFixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const dot = trimmed.indexOf(".");
  const intPart = dot >= 0 ? trimmed.slice(0, dot) : trimmed;
  const frac = dot >= 0 ? trimmed.slice(dot) : "";
  return `${m}:${intPart.padStart(2, "0")}${frac}`;
}

/** Postgres `numeric` may arrive as a string. */
export function coerceProposalSeconds(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
