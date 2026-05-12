import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaRef } from "@/types/media";

export type SavedTransitionPairRow = {
  id: string;
  from_media: MediaRef;
  to_media: MediaRef;
  created_at: string;
};

/** Strip `%` / `_` wildcards and commas (PostgREST `.or()` uses comma) from user input. */
function ilikePattern(q: string): string {
  const cleaned = q.replace(/%/g, "").replace(/_/g, "").replace(/,/g, " ").trim();
  return `%${cleaned}%`;
}

async function fetchSearchCandidateRows(
  supabase: SupabaseClient,
  q: string,
): Promise<SavedTransitionPairRow[]> {
  const p = ilikePattern(q.trim());
  const orPair = `from_media->>videoId.ilike.${p},to_media->>videoId.ilike.${p},from_media->>title.ilike.${p},to_media->>title.ilike.${p}`;

  const [{ data: rowsText }, { data: cacheHits }] = await Promise.all([
    supabase
      .from("transition_pairs")
      .select("id,from_media,to_media,created_at")
      .or(orPair)
      .order("created_at", { ascending: false })
      .limit(2500),
    supabase
      .from("youtube_video_cache")
      .select("video_id")
      .or(`title.ilike.${p},channel_title.ilike.${p}`)
      .limit(200),
  ]);

  const vidIds = Array.from(
    new Set((cacheHits ?? []).map((r) => String(r.video_id ?? "").trim()).filter((id) => id.length > 0)),
  );
  let fromCache: SavedTransitionPairRow[] = [];
  if (vidIds.length > 0) {
    const [rFrom, rTo] = await Promise.all([
      supabase
        .from("transition_pairs")
        .select("id,from_media,to_media,created_at")
        .in("from_media->>videoId", vidIds)
        .limit(800),
      supabase
        .from("transition_pairs")
        .select("id,from_media,to_media,created_at")
        .in("to_media->>videoId", vidIds)
        .limit(800),
    ]);
    fromCache = [...(rFrom.data ?? []), ...(rTo.data ?? [])] as SavedTransitionPairRow[];
  }

  const byId = new Map<string, SavedTransitionPairRow>();
  for (const r of [...(rowsText ?? []), ...fromCache]) {
    byId.set(r.id, r as SavedTransitionPairRow);
  }
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function fetchSavedTransitionPairsPage(
  supabase: SupabaseClient,
  opts: { page: number; pageSize: number; q: string },
): Promise<{ rows: SavedTransitionPairRow[]; total: number }> {
  const { page, pageSize, q } = opts;
  const trim = q.trim();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (trim.length === 0) {
    const { data, error, count } = await supabase
      .from("transition_pairs")
      .select("id,from_media,to_media,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    return { rows: (data ?? []) as SavedTransitionPairRow[], total: count ?? 0 };
  }

  const merged = await fetchSearchCandidateRows(supabase, trim);
  const total = merged.length;
  const rows = merged.slice(from, to + 1);
  return { rows, total };
}
