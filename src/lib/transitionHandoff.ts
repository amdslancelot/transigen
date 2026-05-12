import type { YTPlayer } from "@/lib/youtubeIframeApi";

/** If B is already at/after the hand-in point (e.g. crossfade), do not seek — avoids restarting B from startNextSec. */
const SEEK_IF_BEHIND_EPS = 0.35;

/**
 * Call from the same user-gesture stack as "Play" (e.g. right after tap). Mutes, cues B, briefly starts then
 * pauses so later hard-cut handoff can `playVideo()` without autoplay blocking (B never played during the edge).
 */
export function primeIncomingDeckMuted(pb: YTPlayer, videoId: string, startSeconds: number) {
  try {
    pb.mute();
    pb.setVolume(0);
    pb.cueVideoById({ videoId, startSeconds });
    pb.playVideo();
    pb.pauseVideo();
    pb.seekTo(startSeconds, true);
  } catch {
    /* noop */
  }
}

export function finishHandoffToB(
  pa: YTPlayer | null | undefined,
  pb: YTPlayer | null | undefined,
  startNextSec: number,
) {
  if (!pb) return;
  try {
    pa?.pauseVideo();
    let tB = 0;
    try {
      tB = pb.getCurrentTime();
    } catch {
      tB = 0;
    }
    if (tB < startNextSec - SEEK_IF_BEHIND_EPS) {
      pb.seekTo(startNextSec, true);
    }
    pb.unMute();
    pb.setVolume(100);
    pb.playVideo();
  } catch {
    /* noop */
  }
}
