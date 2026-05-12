"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmRoomChain } from "@/app/actions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Props = {
  roomId: string;
  /** Last video in the saved set (room start if empty). Next pick must extend from here. */
  extendFromVideoId: string;
  overLimit: boolean;
  /** Known labels from server (set list / cache); other IDs load client-side. */
  initialTrackLabels?: Record<string, string>;
};

function rowToLabel(row: { title?: string | null; channel_title?: string | null }, id: string): string {
  const title = (row.title ?? "").trim();
  const ch = (row.channel_title ?? "").trim();
  if (ch && title) return `${ch} - ${title}`;
  if (title) return title;
  return id;
}

async function fetchDestinationIds(fromVideoId: string): Promise<string[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("transition_pairs")
    .select("to_media")
    .eq("from_media->>provider", "youtube")
    .eq("from_media->>videoId", fromVideoId);

  if (error) throw error;
  const ids = (data ?? [])
    .map((row: { to_media: { videoId?: string } }) => row.to_media?.videoId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return Array.from(new Set(ids));
}

async function fetchVideoTitles(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("youtube_video_cache")
    .select("video_id,title,channel_title")
    .in("video_id", ids);
  if (error) return {};
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    const id = String(row.video_id ?? "");
    if (!id) continue;
    out[id] = rowToLabel(row, id);
  }
  return out;
}

export function RoomChainPicker({
  roomId,
  extendFromVideoId,
  overLimit,
  initialTrackLabels = {},
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [path, setPath] = useState<string[]>([]);
  const [cache, setCache] = useState<Record<string, string[]>>({});
  const [fetchedLabels, setFetchedLabels] = useState<Record<string, string>>({});
  const [loadingCount, setLoadingCount] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [listReloadTick, setListReloadTick] = useState(0);
  const inFlight = useRef<Set<string>>(new Set());
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const listFetchGuard = useRef(0);
  const titleFetchAttemptedRef = useRef<Set<string>>(new Set());

  const labelFor = (id: string) => initialTrackLabels[id] ?? fetchedLabels[id] ?? id;

  useEffect(() => {
    const need = new Set<string>();
    const consider = (id: string) => {
      if (!id || initialTrackLabels[id] || titleFetchAttemptedRef.current.has(id)) return;
      need.add(id);
    };
    consider(extendFromVideoId);
    for (const id of path) consider(id);
    for (const ids of Object.values(cache)) {
      for (const vid of ids) consider(vid);
    }
    const list = [...need];
    if (list.length === 0) return;
    for (const id of list) titleFetchAttemptedRef.current.add(id);
    let cancelled = false;
    void fetchVideoTitles(list).then((got) => {
      if (cancelled) return;
      setFetchedLabels((prev) => ({ ...prev, ...got }));
    });
    return () => {
      cancelled = true;
    };
  }, [cache, path, extendFromVideoId, initialTrackLabels]);

  useEffect(() => {
    const guard = listFetchGuard.current;
    const needed = Array.from(new Set([extendFromVideoId, ...path]));
    for (const id of needed) {
      if (cacheRef.current[id] || inFlight.current.has(id)) continue;
      inFlight.current.add(id);
      setLoadingCount((n) => n + 1);
      setErr(null);
      void fetchDestinationIds(id)
        .then((ids) => {
          if (guard !== listFetchGuard.current) return;
          setCache((p) => (p[id] ? p : { ...p, [id]: ids }));
        })
        .catch((e: unknown) => {
          if (guard !== listFetchGuard.current) return;
          setErr(e instanceof Error ? e.message : "Failed to load transitions");
        })
        .finally(() => {
          inFlight.current.delete(id);
          setLoadingCount((n) => Math.max(0, n - 1));
        });
    }
  }, [extendFromVideoId, path, listReloadTick]);

  const refreshTransitionLists = () => {
    listFetchGuard.current += 1;
    inFlight.current.clear();
    setCache({});
    setListReloadTick((t) => t + 1);
  };

  const levels: { fromId: string; depth: number }[] = [{ fromId: extendFromVideoId, depth: 0 }];
  for (let i = 0; i < path.length; i++) {
    levels.push({ fromId: path[i]!, depth: i + 1 });
  }

  const handlePick = (depth: number, videoId: string) => {
    setPath((prev) => {
      const base = prev.slice(0, depth);
      return [...base, videoId];
    });
  };

  const handleConfirm = () => {
    if (path.length === 0 || overLimit) return;
    setErr(null);
    startTransition(async () => {
      try {
        await confirmRoomChain(roomId, path);
        setPath([]);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not save set");
      }
    });
  };

  return (
    <div className="col" style={{ gap: "0.75rem" }}>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-start" }}>
        <p className="muted" style={{ flex: "1 1 12rem", margin: 0 }}>
          Only transitions already saved (see <Link href="/transition">/transition</Link>) appear here. Pick a chain,
          then confirm once to append it. The highest-voted proposal is used for each link.
        </p>
        <button
          type="button"
          className="secondary"
          onClick={refreshTransitionLists}
          title="Reload saved next-song options (e.g. after someone adds a transition)"
        >
          Refresh
        </button>
      </div>
      <p>
        Extending from: <strong>{labelFor(extendFromVideoId)}</strong>
        <span className="muted" style={{ marginLeft: "0.35rem", fontFamily: "monospace", fontSize: "0.85em" }}>
          {extendFromVideoId}
        </span>
      </p>
      {levels.map(({ fromId, depth }) => {
        const opts = cache[fromId] ?? [];
        return (
          <div key={`${fromId}-${depth}`} className="col" style={{ gap: "0.35rem" }}>
            <span className="muted">
              From <strong>{labelFor(fromId)}</strong> → pick next
            </span>
            {opts.length === 0 && loadingCount === 0 ? (
              <p className="muted">
                No saved transitions from this song yet. Add one on{" "}
                <Link href="/transition/new">/transition/new</Link>.
              </p>
            ) : opts.length === 0 && loadingCount > 0 ? (
              <span className="muted">Loading…</span>
            ) : (
              <div className="row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
                {opts.map((vid) => (
                  <button
                    key={vid}
                    type="button"
                    className={path[depth] === vid ? "pill" : "secondary"}
                    style={{ maxWidth: "100%", textAlign: "left" }}
                    title={vid}
                    onClick={() => handlePick(depth, vid)}
                  >
                    <span style={{ display: "block", fontWeight: 600 }}>{labelFor(vid)}</span>
                    <span className="muted" style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                      {vid}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {err ? <p style={{ color: "#f87171" }}>{err}</p> : null}
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <button type="button" className="secondary" onClick={() => setPath([])} disabled={path.length === 0}>
          Clear preview
        </button>
        <button type="button" onClick={handleConfirm} disabled={path.length === 0 || overLimit || isPending}>
          {isPending ? "Saving…" : "Confirm add to set"}
        </button>
      </div>
      {path.length > 0 ? (
        <p className="muted">
          Preview tail:{" "}
          {path.map((id, i) => (
            <span key={`${id}-${i}`}>
              {i > 0 ? " → " : null}
              <strong>{labelFor(id)}</strong>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
