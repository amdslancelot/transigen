"use client";

import type { MediaRef } from "@/types/media";
import { YouTubePlayer } from "./YouTubePlayer";

type Props = {
  media: MediaRef;
  label: string;
  startAt?: number | null;
};

export function MediaPlayer({ media, label, startAt }: Props) {
  if (media.provider === "youtube") {
    return <YouTubePlayer label={label} videoId={media.videoId} startAt={startAt} />;
  }

  if (media.provider === "spotify") {
    return (
      <div className="panel">
        <p>Spotify player stub for {label}</p>
        <p className="muted">Spotify support will be added with Web Playback SDK.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <p>File player stub for {label}</p>
      <p className="muted">mp3/wav upload playback will be added in a future phase.</p>
    </div>
  );
}
