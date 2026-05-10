"use client";

import { useMemo, useState } from "react";
import { extractYoutubeVideoId } from "@/lib/youtube";
import { YouTubePlayer } from "./YouTubePlayer";

type Props = {
  fromInput: string;
  toInput: string;
  endPrevSec: number | null;
  startNextSec: number | null;
};

export function TransitionPreview({ fromInput, toInput, endPrevSec, startNextSec }: Props) {
  const [timeA, setTimeA] = useState(0);
  const fromVideoId = useMemo(() => extractYoutubeVideoId(fromInput) ?? undefined, [fromInput]);
  const toVideoId = useMemo(() => extractYoutubeVideoId(toInput) ?? undefined, [toInput]);

  const shouldStartB = endPrevSec != null && timeA >= endPrevSec;

  return (
    <div className="col" style={{ gap: "0.75rem" }}>
      <p className="muted">
        Preview mode: play song A from 0. At A={endPrevSec ?? "--"}s, you start song B at
        B={startNextSec ?? 0}s.
      </p>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <YouTubePlayer label="Song A" videoId={fromVideoId} startAt={0} onTime={setTimeA} />
        </div>
        <div style={{ flex: 1 }}>
          <YouTubePlayer
            label="Song B"
            videoId={toVideoId}
            startAt={shouldStartB ? startNextSec ?? 0 : undefined}
          />
        </div>
      </div>
    </div>
  );
}
