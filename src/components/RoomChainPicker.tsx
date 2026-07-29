"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmRoomChain, fetchTransitionDestinations, fetchVideoLabels } from "@/app/actions";

type Props = {
  roomId: string;
  /** Last video in the saved set (room start if empty). Next pick must extend from here. */
  extendFromVideoId: string;
  overLimit: boolean;
  /** Known labels from server (set list / cache); other IDs load client-side. */
  initialTrackLabels?: Record<string, string>;
};

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
    void fetchVideoLabels(list)
      .then((got) => {
        if (cancelled) return;
        setFetchedLabels((prev) => ({ ...prev, ...got }));
      })
      .catch(() => {
        /* labels are cosmetic; fall back to raw ids */
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
      void fetchTransitionDestinations(id)
        .then((ids) => {
          if (guard !== listFetchGuard.current) return;
          setCache((p) => (p[id] ? p : { ...p, [id]: ids }));
        })
        .catch((e: unknown) => {
          if (guard !== listFetchGuard.current) return;
          setErr(e instanceof Error ? e.message : "could not load transitions");
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
        setErr(e instanceof Error ? e.message : "could not save the set");
      }
    });
  };

  return (
    <div className="col" style={{ gap: "0.85rem" }}>
      <style>{`
        button.chain-card {
          background: var(--surface);
          color: var(--ink);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.4rem 0.55rem;
          text-align: left;
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
          min-width: 0;
        }
        button.chain-card:hover:not(:disabled) {
          background: var(--surface);
          border-color: var(--muted);
        }
        button.chain-card-selected,
        button.chain-card-selected:hover:not(:disabled) {
          background: var(--ink);
          border-color: var(--ink);
          color: var(--surface);
        }
        .chain-card-title {
          font-size: 0.8rem;
          font-weight: 500;
          line-height: 1.25;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .chain-card-id {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.68rem;
          color: var(--muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        button.chain-card-selected .chain-card-id {
          color: var(--surface);
          opacity: 0.6;
        }
      `}</style>
      {levels.map(({ fromId, depth }) => {
        const opts = cache[fromId] ?? [];
        return (
          <div key={`${fromId}-${depth}`} className="col" style={{ gap: "0.35rem" }}>
            <div className="row" style={{ gap: "0.45rem", alignItems: "baseline", flexWrap: "nowrap" }}>
              <span
                className="muted"
                style={{
                  fontSize: "0.75rem",
                  flex: "1 1 auto",
                  minWidth: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                after {labelFor(fromId)}
              </span>
              {depth === 0 ? (
                <button
                  type="button"
                  className="secondary"
                  style={{ fontSize: "0.72rem", padding: "0.25rem 0.55rem", flex: "0 0 auto" }}
                  onClick={refreshTransitionLists}
                >
                  refresh
                </button>
              ) : null}
            </div>
            {opts.length === 0 && loadingCount === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                no saved transitions from here yet —{" "}
                <Link href="/transition/new" style={{ textDecoration: "underline" }}>
                  add one
                </Link>
              </p>
            ) : opts.length === 0 && loadingCount > 0 ? (
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                loading…
              </span>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))",
                  gap: "0.4rem",
                }}
              >
                {opts.map((vid) => (
                  <button
                    key={vid}
                    type="button"
                    className={path[depth] === vid ? "chain-card chain-card-selected" : "chain-card"}
                    title={vid}
                    onClick={() => handlePick(depth, vid)}
                  >
                    <span className="chain-card-title">{labelFor(vid)}</span>
                    <span className="chain-card-id">{vid}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {err ? (
        <p style={{ color: "var(--danger)", fontSize: "0.75rem", margin: 0 }}>{err}</p>
      ) : null}
      {path.length > 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
          queued:{" "}
          {path.map((id, i) => (
            <span key={`${id}-${i}`}>
              {i > 0 ? " → " : null}
              {labelFor(id)}
            </span>
          ))}
        </p>
      ) : null}
      <div className="row" style={{ gap: "0.5rem" }}>
        <button type="button" onClick={handleConfirm} disabled={path.length === 0 || overLimit || isPending}>
          {isPending ? "saving…" : "add to set"}
        </button>
        <button type="button" className="secondary" onClick={() => setPath([])} disabled={path.length === 0}>
          clear
        </button>
      </div>
    </div>
  );
}
