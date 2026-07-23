"use client";

import { useEffect, useState } from "react";

// Live analysis progress over SSE: the stream route LISTENs on the
// ingest_jobs_changed Postgres channel and pushes {done,total} counts.
export function TrackIngestStatus({ videoIds }: { videoIds: string[] }) {
  const [doneCount, setDoneCount] = useState(0);

  useEffect(() => {
    if (videoIds.length === 0) return;

    const source = new EventSource(
      `/api/ingest-status/stream?ids=${encodeURIComponent(videoIds.join(","))}`,
    );
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { done?: number };
        if (typeof data.done === "number") setDoneCount(data.done);
      } catch {
        /* ignore malformed events */
      }
    };

    return () => {
      source.close();
    };
  }, [videoIds]);

  if (videoIds.length === 0 || doneCount >= videoIds.length) return null;

  return <div className="muted">分析中 {doneCount}/{videoIds.length} 首</div>;
}
