"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatMinSec } from "@/lib/timeInput";
import { loadYoutubeIframeApi } from "@/lib/youtubeIframeApi";
import type { YTPlayer } from "@/lib/youtubeIframeApi";
import { WaveformLikeVisualizer } from "./WaveformLikeVisualizer";

type Props = {
  label: string;
  videoId?: string;
  startAt?: number | null;
  onTime?: (t: number) => void;
};

export function YouTubePlayer({ label, videoId, startAt, onTime }: Props) {
  const baseId = useId().replace(/:/g, "");
  const containerId = `yt-simple-${baseId}`;
  const playerRef = useRef<YTPlayer | null>(null);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
  const [now, setNow] = useState(0);
  const [durationSec, setDurationSec] = useState(240);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoId) {
      try {
        playerRef.current?.destroy();
      } catch {
        /* noop */
      }
      playerRef.current = null;
      return undefined;
    }

    let cancelled = false;
    const start =
      startAt != null && Number.isFinite(startAt) && startAt > 0 ? Math.max(0, startAt) : 0;

    const origin =
      typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : undefined;

    void loadYoutubeIframeApi()
      .then((YT) => {
        if (cancelled) return;
        try {
          playerRef.current?.destroy();
        } catch {
          /* noop */
        }
        playerRef.current = null;

        new YT.Player(containerId, {
          height: 220,
          width: "100%",
          videoId,
          playerVars: {
            enablejsapi: 1,
            playsinline: 1,
            controls: 1,
            rel: 0,
            ...(origin ? { origin } : {}),
          },
          events: {
            onReady: (ev) => {
              if (cancelled) return;
              playerRef.current = ev.target;
              try {
                if (start > 0) {
                  ev.target.seekTo(start, true);
                }
                ev.target.pauseVideo();
              } catch {
                /* noop */
              }
              try {
                const t = ev.target.getCurrentTime();
                setNow(t);
                onTimeRef.current?.(t);
                const d = ev.target.getDuration();
                if (Number.isFinite(d) && d > 1) setDurationSec(d);
              } catch {
                setNow(start);
              }
            },
          },
        });
        setApiError(null);
      })
      .catch(() => {
        if (!cancelled) setApiError("YouTube player failed to load.");
      });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* noop */
      }
      playerRef.current = null;
    };
  }, [videoId, startAt, containerId]);

  useEffect(() => {
    if (!videoId) return undefined;
    const id = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        const t = p.getCurrentTime();
        setNow(t);
        onTimeRef.current?.(t);
      } catch {
        /* noop */
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [videoId]);

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
        <span className="muted">t={formatMinSec(now)}</span>
      </div>
      {apiError ? (
        <p style={{ color: "#fca5a5", margin: 0 }}>{apiError}</p>
      ) : null}
      <div id={containerId} />
      <WaveformLikeVisualizer currentSec={now} durationSec={durationSec} label={`${label} waveform`} />
    </div>
  );
}
