"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function TrackIngestStatus({ videoIds }: { videoIds: string[] }) {
  const [doneCount, setDoneCount] = useState(0);

  useEffect(() => {
    if (videoIds.length === 0) return;

    const supabase = getSupabaseBrowserClient();

    // Initial load
    supabase
      .from("ingest_jobs")
      .select("status")
      .in("video_id", videoIds)
      .then(({ data }) => {
        const done = (data ?? []).filter((r) => r.status === "done" || r.status === "failed").length;
        setDoneCount(done);
      });

    // Realtime updates
    const channel = supabase
      .channel("ingest_jobs_status")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ingest_jobs",
          filter: `video_id=in.(${videoIds.join(",")})`,
        },
        () => {
          // Re-query on any change — ponytail: re-fetch over diff-tracking, simpler and correct
          supabase
            .from("ingest_jobs")
            .select("status")
            .in("video_id", videoIds)
            .then(({ data }) => {
              const done = (data ?? []).filter((r) => r.status === "done" || r.status === "failed").length;
              setDoneCount(done);
            });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [videoIds]);

  if (doneCount >= videoIds.length) return null;

  return <div className="muted">分析中 {doneCount}/{videoIds.length} 首</div>;
}
