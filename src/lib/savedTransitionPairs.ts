import { query } from "@/lib/db";
import type { MediaRef } from "@/types/media";

export type SavedTransitionPairRow = {
  id: string;
  from_media: MediaRef;
  to_media: MediaRef;
  created_at: string;
};

/** Escape ILIKE wildcards in user input (pattern uses `escape '\'`). */
function escapeIlike(q: string): string {
  return q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Matches a pair when the query hits either side's videoId/title, or the
// cached YouTube title/channel of either side.
const SEARCH_FROM_WHERE = `
  from transition_pairs tp
  left join youtube_video_cache yf on yf.video_id = tp.from_media->>'videoId'
  left join youtube_video_cache yt on yt.video_id = tp.to_media->>'videoId'
  where tp.from_media->>'videoId' ilike $1 escape '\\'
     or tp.to_media->>'videoId' ilike $1 escape '\\'
     or tp.from_media->>'title' ilike $1 escape '\\'
     or tp.to_media->>'title' ilike $1 escape '\\'
     or coalesce(yf.title, '') ilike $1 escape '\\'
     or coalesce(yf.channel_title, '') ilike $1 escape '\\'
     or coalesce(yt.title, '') ilike $1 escape '\\'
     or coalesce(yt.channel_title, '') ilike $1 escape '\\'
`;

export async function fetchSavedTransitionPairsPage(opts: {
  page: number;
  pageSize: number;
  q: string;
}): Promise<{ rows: SavedTransitionPairRow[]; total: number }> {
  const { page, pageSize, q } = opts;
  const trim = q.trim();
  const offset = (page - 1) * pageSize;

  if (trim.length === 0) {
    const [rows, countRows] = await Promise.all([
      query<SavedTransitionPairRow>(
        `select id, from_media, to_media, created_at::text as created_at
         from transition_pairs
         order by created_at desc
         limit $1 offset $2`,
        [pageSize, offset],
      ),
      query<{ count: string }>(`select count(*)::bigint as count from transition_pairs`),
    ]);
    return { rows, total: Number(countRows[0]?.count ?? 0) };
  }

  const pattern = `%${escapeIlike(trim)}%`;
  const [rows, countRows] = await Promise.all([
    query<SavedTransitionPairRow>(
      `select distinct tp.id, tp.from_media, tp.to_media, tp.created_at::text as created_at
       ${SEARCH_FROM_WHERE}
       order by created_at desc
       limit $2 offset $3`,
      [pattern, pageSize, offset],
    ),
    query<{ count: string }>(
      `select count(distinct tp.id)::bigint as count ${SEARCH_FROM_WHERE}`,
      [pattern],
    ),
  ]);
  return { rows, total: Number(countRows[0]?.count ?? 0) };
}
