/** YouTube default thumbnail for a video id (mq ~ 320px wide). */
export function youtubeMqThumbnailUrl(videoId: string | undefined | null): string | null {
  if (!videoId || typeof videoId !== "string") return null;
  const id = videoId.trim();
  if (!id) return null;
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}
