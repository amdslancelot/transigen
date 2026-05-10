"use client";

import { useEffect, useMemo, useState } from "react";
import { formatSec } from "@/lib/youtube";
import { WaveformLikeVisualizer } from "./WaveformLikeVisualizer";

type Props = {
  label: string;
  videoId?: string;
  startAt?: number | null;
  onTime?: (t: number) => void;
};

export function YouTubePlayer({ label, videoId, startAt, onTime }: Props) {
  const [now, setNow] = useState(0);
  const src = useMemo(() => {
    if (!videoId) return "";
    const start = startAt && startAt > 0 ? `&start=${Math.floor(startAt)}` : "";
    return `https://www.youtube.com/embed/${videoId}?enablejsapi=1${start}`;
  }, [videoId, startAt]);

  useEffect(() => {
    if (!videoId) return;
    const timer = setInterval(() => {
      setNow((v) => {
        const n = v + 1;
        onTime?.(n);
        return n;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [videoId, onTime]);

  if (!videoId) {
    return (
      <div className="panel">
        <p className="muted">{label}: no video selected.</p>
      </div>
    );
  }

  return (
    <div className="panel col">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{label}</strong>
        <span className="muted">t={formatSec(now)}</span>
      </div>
      <iframe
        title={label}
        src={src}
        width="100%"
        height="220"
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <WaveformLikeVisualizer currentSec={now} durationSec={240} label={`${label} waveform`} />
    </div>
  );
}
