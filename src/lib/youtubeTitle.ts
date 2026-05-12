/**
 * Sanitize a YouTube video title into a (title, optional artist) pair so we
 * can search for the matching Spotify track.
 *
 * Heuristics:
 * - Strip noise tags: (Official Video), [MV], (Lyric Video), 4K, HD, Remastered…
 * - If title contains " - ", treat the left side as artist and right as song.
 * - Use channelTitle as fallback artist hint (drop trailing " - Topic").
 */

const NOISE_PATTERNS = [
  /\(\s*official(?:\s+(?:music\s+)?video|\s+audio|\s+lyrics?\s+video|\s+visualizer)?\s*\)/gi,
  /\[\s*official(?:\s+(?:music\s+)?video|\s+audio|\s+lyrics?\s+video|\s+visualizer)?\s*\]/gi,
  /\(\s*lyric[s]?(?:\s+video)?\s*\)/gi,
  /\[\s*lyric[s]?(?:\s+video)?\s*\]/gi,
  /\(\s*(?:hd|hq|4k|8k|remastered|audio|video|mv|m\/v|live|visualizer)\s*\)/gi,
  /\[\s*(?:hd|hq|4k|8k|remastered|audio|video|mv|m\/v|live|visualizer)\s*\]/gi,
  /【[^】]*?(官方|official|MV|mv|live|Live|歌詞|lyric|Lyric)[^】]*】/g,
  /\(\s*prod\.?\s+by[^)]*\)/gi,
  /\bft\.\s+/gi,
  /\bfeat\.\s+/gi,
];

function cleanNoise(s: string) {
  let out = s;
  for (const re of NOISE_PATTERNS) {
    out = out.replace(re, " ");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

export function parseYoutubeTitle(rawTitle: string, channelTitle?: string) {
  const cleaned = cleanNoise(rawTitle);

  let title = cleaned;
  let artist: string | undefined;

  const dashSplit = cleaned.split(/\s[-–—]\s/);
  if (dashSplit.length >= 2) {
    artist = dashSplit[0].trim();
    title = dashSplit.slice(1).join(" - ").trim();
  }

  if (!artist && channelTitle) {
    artist = channelTitle.replace(/\s*-\s*Topic\s*$/i, "").trim() || undefined;
  }

  title = title.replace(/[「『【]/g, "").replace(/[」』】]/g, "").trim();

  return { title, artist };
}
