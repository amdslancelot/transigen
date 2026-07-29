/**
 * Humanize transition preset codes for display.
 *
 * The parsing rules mirror `formatPresetLabel` in `src/app/room/[roomId]/page.tsx`
 * (a trailing `_<digits>` segment is read as a bar count); when that page is next
 * touched, its local copy can be replaced by an import from here.
 */

/** Turn a preset code like "stutter_4" into a human label ("stutter · 4 bars"). */
export function formatPresetLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const parts = code.split("_");
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^\d+$/.test(last)) {
    const n = Number(last);
    return `${parts.slice(0, -1).join(" ")} · ${n} ${n === 1 ? "bar" : "bars"}`;
  }
  return parts.join(" ");
}

/** Compact variant for tight spaces ("stutter · 4", "fade · 8", "hard cut"). */
export function formatPresetLabelShort(code: string | null | undefined): string | null {
  if (!code) return null;
  const parts = code.split("_");
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^\d+$/.test(last)) {
    return `${parts.slice(0, -1).join(" ")} · ${Number(last)}`;
  }
  return parts.join(" ");
}
