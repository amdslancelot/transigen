/**
 * YouTube Data API v3 helpers (server-only).
 *
 * Quota: each `videos.list` call costs 1 unit. Default project quota is
 * 10,000 units / day, which covers ~10k cold lookups per day; results are
 * cached in `youtube_video_cache` so repeated lookups cost 0 quota.
 */

export type YoutubeVideoMeta = {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  durationSec: number;
  description: string;
  thumbnails: Record<string, unknown>;
  raw: unknown;
};

type ApiVideoItem = {
  id: string;
  snippet: {
    title: string;
    channelTitle: string;
    channelId: string;
    description: string;
    thumbnails: Record<string, unknown>;
  };
  contentDetails: { duration: string };
};

function getKey() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error("Missing YOUTUBE_API_KEY in environment.");
  }
  return key;
}

export function parseIso8601Duration(input: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(input);
  if (!m) return 0;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  return Math.floor(h * 3600 + min * 60 + s);
}

export async function fetchYoutubeVideoMeta(
  videoId: string,
): Promise<YoutubeVideoMeta | null> {
  const key = getKey();
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", key);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { items?: ApiVideoItem[] };
  const item = data.items?.[0];
  if (!item) return null;

  return {
    videoId: item.id,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    channelId: item.snippet.channelId,
    durationSec: parseIso8601Duration(item.contentDetails.duration),
    description: item.snippet.description ?? "",
    thumbnails: item.snippet.thumbnails ?? {},
    raw: item,
  };
}
