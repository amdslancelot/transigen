"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  autoBpmForYoutube,
  createTransitionProposal,
  lookupYoutubeMeta,
  type AutoBpmResult,
  type TransitionProposalActionState,
  type YoutubeMetaResult,
} from "@/app/actions";
import { TransitionLivePreview } from "@/components/TransitionLivePreview";
import { extractYoutubeVideoId } from "@/lib/youtube";
import { formatMinSec, parseProposalTime, roundProposalSeconds } from "@/lib/timeInput";
import { buildPresetPlan } from "@/lib/transitionPresetPlan";
import type { TransitionPreset } from "@/types/db";

type Props = {
  presets: TransitionPreset[];
  initialFrom: string;
  initialTo: string;
  /** When opening this page with Song A only (no B), server may prefetch A metadata for first paint. */
  prefetchedSongAMeta?: Extract<YoutubeMetaResult, { ok: true }> | null;
};

type MetaState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; videoId: string; title: string; channelTitle: string; durationSec: number | null; cached: boolean }
  | { status: "error"; error: string };

function useYoutubeMeta(
  videoId: string | null,
  serverPrefetch: Extract<YoutubeMetaResult, { ok: true }> | null,
) {
  const [state, setState] = useState<MetaState>(() => {
    if (videoId && serverPrefetch && serverPrefetch.videoId === videoId) {
      return {
        status: "ok",
        videoId: serverPrefetch.videoId,
        title: serverPrefetch.title,
        channelTitle: serverPrefetch.channelTitle,
        durationSec: serverPrefetch.durationSec,
        cached: serverPrefetch.cached,
      };
    }
    return { status: "idle" };
  });
  const lastFetchedRef = useRef<string | null>(
    videoId && serverPrefetch && serverPrefetch.videoId === videoId ? videoId : null,
  );

  useEffect(() => {
    if (!videoId) {
      lastFetchedRef.current = null;
      setState({ status: "idle" });
      return;
    }

    if (serverPrefetch && serverPrefetch.videoId === videoId) {
      lastFetchedRef.current = videoId;
      setState({
        status: "ok",
        videoId: serverPrefetch.videoId,
        title: serverPrefetch.title,
        channelTitle: serverPrefetch.channelTitle,
        durationSec: serverPrefetch.durationSec,
        cached: serverPrefetch.cached,
      });
      return;
    }

    if (lastFetchedRef.current === videoId) return;
    lastFetchedRef.current = videoId;

    let cancelled = false;
    setState({ status: "loading" });
    lookupYoutubeMeta(videoId).then((res: YoutubeMetaResult) => {
      if (cancelled) return;
      if (res.ok) {
        setState({
          status: "ok",
          videoId: res.videoId,
          title: res.title,
          channelTitle: res.channelTitle,
          durationSec: res.durationSec,
          cached: res.cached,
        });
      } else {
        setState({ status: "error", error: res.error });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [videoId, serverPrefetch]);

  return state;
}

export function TransitionComposer({
  presets,
  initialFrom,
  initialTo,
  prefetchedSongAMeta = null,
}: Props) {
  const router = useRouter();
  const [fromRaw, setFromRaw] = useState(initialFrom);
  const [toRaw, setToRaw] = useState(initialTo);

  useEffect(() => {
    setFromRaw(initialFrom);
    setToRaw(initialTo);
  }, [initialFrom, initialTo]);
  const [endStr, setEndStr] = useState("");
  const [startStr, setStartStr] = useState("");
  const [note, setNote] = useState("");
  const [bpmStr, setBpmStr] = useState("120");
  const [fadeBars, setFadeBars] = useState<1 | 2 | 4>(2);

  const sortedPresets = useMemo(
    () => [...presets].sort((a, b) => a.label.localeCompare(b.label)),
    [presets],
  );

  const defaultPresetId = useMemo(() => {
    return sortedPresets.find((p) => p.code === "hard_cut")?.id ?? sortedPresets[0]?.id ?? "";
  }, [sortedPresets]);

  const [presetId, setPresetId] = useState(defaultPresetId);

  useEffect(() => {
    if (defaultPresetId && !presetId) setPresetId(defaultPresetId);
  }, [defaultPresetId, presetId]);

  const [state, formAction, pending] = useActionState(
    createTransitionProposal,
    undefined as TransitionProposalActionState | undefined,
  );

  const fromId = useMemo(() => extractYoutubeVideoId(fromRaw), [fromRaw]);
  const toId = useMemo(() => extractYoutubeVideoId(toRaw), [toRaw]);

  const songAMetaPrefetch = useMemo(
    () =>
      prefetchedSongAMeta && fromId && prefetchedSongAMeta.videoId === fromId ? prefetchedSongAMeta : null,
    [prefetchedSongAMeta, fromId],
  );

  const metaA = useYoutubeMeta(fromId ?? null, songAMetaPrefetch);
  const metaB = useYoutubeMeta(toId ?? null, null);
  const durA = metaA.status === "ok" ? metaA.durationSec : null;
  const durB = metaB.status === "ok" ? metaB.durationSec : null;

  const selectedPreset = sortedPresets.find((p) => p.id === presetId);
  const presetCode = selectedPreset?.code ?? "";
  const needsBpm = presetCode !== "hard_cut";

  useEffect(() => {
    if (!fromId || !toId) return;
    const q = new URLSearchParams();
    q.set("fromVideo", fromRaw.trim());
    q.set("toVideo", toRaw.trim());
    router.replace(`/transition/new?${q.toString()}`, { scroll: false });
  }, [fromId, toId, fromRaw, toRaw, router]);

  const endParsed = useMemo(() => (endStr === "" ? null : parseProposalTime(endStr)), [endStr]);
  const startParsed = useMemo(() => (startStr === "" ? null : parseProposalTime(startStr)), [startStr]);

  const endValid =
    endParsed !== null && endParsed >= 0 && (durA == null || endParsed <= durA + 1e-6);
  const startValid =
    startParsed !== null && startParsed >= 0 && (durB == null || startParsed <= durB + 1e-6);

  const bpmNum = Number(bpmStr);
  const bpmValid = Number.isFinite(bpmNum) && bpmNum > 0 && bpmNum <= 300;

  const plan = useMemo(
    () =>
      buildPresetPlan(
        presetCode,
        needsBpm ? bpmNum : null,
        presetCode === "fade" || presetCode === "fade_like" ? fadeBars : null,
      ),
    [presetCode, needsBpm, bpmNum, fadeBars],
  );

  const windowOk =
    plan.kind === "cut" || endParsed === null || !Number.isFinite(endParsed) || endParsed >= plan.window - 1e-6;

  const paramsJson =
    presetCode === "fade" || presetCode === "fade_like" ? JSON.stringify({ fade_bars: fadeBars }) : "{}";

  const readyToPreview = Boolean(
    fromId &&
      toId &&
      endValid &&
      startValid &&
      presetId &&
      (!needsBpm || bpmValid) &&
      windowOk,
  );

  const canSave =
    readyToPreview &&
    (!needsBpm || bpmValid) &&
    ((presetCode !== "fade" && presetCode !== "fade_like") || [1, 2, 4].includes(fadeBars));

  function clampEndField() {
    if (durA == null || endStr === "") return;
    const n = parseProposalTime(endStr);
    if (n == null) return;
    const c = roundProposalSeconds(Math.min(durA, Math.max(0, n)));
    setEndStr(formatMinSec(c));
  }

  function clampStartField() {
    if (durB == null || startStr === "") return;
    const n = parseProposalTime(startStr);
    if (n == null) return;
    const c = roundProposalSeconds(Math.min(durB, Math.max(0, n)));
    setStartStr(formatMinSec(c));
  }

  const [bpmState, setBpmState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ok"; bpm: number; matchedTitle: string; matchedArtist: string; cached: boolean }
    | { status: "error"; error: string }
  >({ status: "idle" });
  const [bpmPending, startBpmTransition] = useTransition();

  const requestAutoBpm = useCallback(() => {
    if (!fromId) return;
    setBpmState({ status: "loading" });
    startBpmTransition(async () => {
      const res: AutoBpmResult = await autoBpmForYoutube(fromId);
      if (res.ok) {
        setBpmState({
          status: "ok",
          bpm: res.bpm,
          matchedTitle: res.matchedTitle,
          matchedArtist: res.matchedArtist,
          cached: res.cached,
        });
        setBpmStr(String(res.bpm));
      } else {
        setBpmState({ status: "error", error: res.error });
      }
    });
  }, [fromId]);

  const startNewFromSongB = () => {
    const q = toRaw.trim();
    if (!toId || !q) return;
    const url = `${window.location.origin}/transition/new?fromVideo=${encodeURIComponent(q)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="panel col">
      <h2>Create New Transition</h2>
      <form className="col" action={formAction}>
        <div className="row">
          <div className="col" style={{ flex: 1 }}>
            <div style={{ minHeight: "2.5rem" }} aria-hidden />
            <label htmlFor="fromVideo">Song A YouTube URL/ID</label>
            <input
              id="fromVideo"
              name="fromVideo"
              value={fromRaw}
              onChange={(e) => setFromRaw(e.target.value)}
              required
              autoComplete="off"
            />
            <MetaHint videoId={fromId} state={metaA} />
          </div>
          <div className="col" style={{ flex: 1 }}>
            <button
              type="button"
              className="secondary"
              onClick={startNewFromSongB}
              disabled={!toId}
              title={
                !toId
                  ? "Enter a valid Song B YouTube URL or ID first"
                  : "Open a new tab: Song A is this Song B; Song B is empty; metadata is prefilled"
              }
            >
              Start New From Song B
            </button>
            <label htmlFor="toVideo">Song B YouTube URL/ID</label>
            <input
              id="toVideo"
              name="toVideo"
              value={toRaw}
              onChange={(e) => setToRaw(e.target.value)}
              required
              autoComplete="off"
            />
            <MetaHint videoId={toId} state={metaB} />
          </div>
        </div>

        <div className="row">
          <div className="col" style={{ flex: 1 }}>
            <label htmlFor="endPrevSec">End time on Song A (m:ss.fff)</label>
            <input
              id="endPrevSec"
              name="endPrevSec"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="1:30.5"
              value={endStr}
              onChange={(e) => setEndStr(e.target.value)}
              onBlur={clampEndField}
              required
            />
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              {durA != null
                ? `0:00–${formatMinSec(durA)} (within video length)`
                : "Format minutes:seconds, seconds may use decimals (e.g. 0:05.25)."}
            </span>
          </div>
          <div className="col" style={{ flex: 1 }}>
            <label htmlFor="startNextSec">Start time on Song B (m:ss.fff)</label>
            <input
              id="startNextSec"
              name="startNextSec"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0:00"
              value={startStr}
              onChange={(e) => setStartStr(e.target.value)}
              onBlur={clampStartField}
              required
            />
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              {durB != null
                ? `0:00–${formatMinSec(durB)} (within video length)`
                : "Format minutes:seconds, seconds may use decimals (e.g. 0:05.25)."}
            </span>
          </div>
        </div>

        <div className="row">
          <div className="col" style={{ flex: 1 }}>
            <label htmlFor="presetId">Transition preset</label>
            <select
              id="presetId"
              name="presetId"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              required
            >
              {sortedPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {presetCode === "fade" || presetCode === "fade_like" ? (
            <div className="col" style={{ flex: 1 }}>
              <label htmlFor="fadeBars">Fade crossfade length (bars)</label>
              <select
                id="fadeBars"
                value={fadeBars}
                onChange={(e) => setFadeBars(Number(e.target.value) as 1 | 2 | 4)}
              >
                <option value={1}>1 bar</option>
                <option value={2}>2 bars</option>
                <option value={4}>4 bars</option>
              </select>
            </div>
          ) : (
            <div className="col" style={{ flex: 1 }} />
          )}
        </div>

        {needsBpm ? (
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="col" style={{ flex: 1 }}>
              <label htmlFor="prev_bpm">BPM (Song A reference)</label>
              <div className="row" style={{ gap: "0.5rem" }}>
                <input
                  id="prev_bpm"
                  name="prev_bpm"
                  type="number"
                  min={1}
                  max={300}
                  step={0.01}
                  value={bpmStr}
                  onChange={(e) => setBpmStr(e.target.value)}
                  required
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={requestAutoBpm}
                  disabled={!fromId || bpmPending}
                  title={!fromId ? "Enter Song A first" : "Look up BPM via Spotify"}
                >
                  {bpmPending ? "Looking up…" : "Auto BPM"}
                </button>
              </div>
              <BpmHint state={bpmState} />
            </div>
            <div className="col" style={{ flex: 2 }} />
          </div>
        ) : (
          <input type="hidden" name="prev_bpm" value="" />
        )}

        <input type="hidden" name="params" value={paramsJson} />

        <div className="col">
          <label htmlFor="note">Notes (optional)</label>
          <input id="note" name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this transition works…" />
        </div>

        {!windowOk && endParsed != null && Number.isFinite(endParsed) ? (
          <p className="muted" style={{ color: "#fca5a5" }}>
            End time on A must be at least {plan.window.toFixed(2)}s for this preset (stutter/echo/fade window).
          </p>
        ) : null}

        {state?.ok === false ? (
          <p style={{ color: "#fca5a5", margin: 0 }}>{state.error}</p>
        ) : null}
        {state?.ok ? <p className="muted" style={{ margin: 0 }}>{state.message ?? "Saved."}</p> : null}

        <TransitionLivePreview
          videoIdA={fromId ?? undefined}
          videoIdB={toId ?? undefined}
          durationA={durA}
          durationB={durB}
          endPrevSec={endParsed ?? 0}
          startNextSec={startParsed ?? 0}
          presetCode={presetCode}
          bpm={needsBpm ? bpmNum : null}
          fadeBars={presetCode === "fade" || presetCode === "fade_like" ? fadeBars : null}
          readyToPreview={readyToPreview}
        />

        <div className="row">
          <button type="submit" disabled={!canSave || pending}>
            {pending ? "Saving…" : "Save proposal"}
          </button>
        </div>
      </form>
    </section>
  );
}

function MetaHint({ videoId, state }: { videoId: string | null; state: MetaState }) {
  if (!videoId) {
    return (
      <span className="muted" style={{ fontSize: "0.85rem" }}>
        Paste a valid YouTube link or 11-char ID.
      </span>
    );
  }
  if (state.status === "loading") {
    return (
      <span className="muted" style={{ fontSize: "0.85rem" }}>
        Loading metadata…
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span style={{ fontSize: "0.85rem", color: "#fca5a5" }}>
        {state.error} (you can still set times manually)
      </span>
    );
  }
  if (state.status === "ok") {
    return (
      <span className="muted" style={{ fontSize: "0.85rem" }}>
        {state.title}
        {state.channelTitle ? ` · ${state.channelTitle}` : ""}
        {state.durationSec != null
          ? ` · ${formatMinSec(state.durationSec)} (${state.durationSec}s total)`
          : " · duration unavailable"}
        {state.cached ? " · cached" : ""}
      </span>
    );
  }
  return null;
}

function BpmHint({
  state,
}: {
  state:
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ok"; bpm: number; matchedTitle: string; matchedArtist: string; cached: boolean }
    | { status: "error"; error: string };
}) {
  if (state.status === "idle") return null;
  if (state.status === "loading")
    return (
      <span className="muted" style={{ fontSize: "0.85rem" }}>
        Looking up BPM via Spotify…
      </span>
    );
  if (state.status === "error")
    return (
      <span style={{ fontSize: "0.85rem", color: "#fca5a5" }}>
        Auto BPM failed: {state.error}
      </span>
    );
  return (
    <span className="muted" style={{ fontSize: "0.85rem" }}>
      Spotify match: {state.matchedTitle}
      {state.matchedArtist ? ` — ${state.matchedArtist}` : ""} · {state.bpm} BPM
      {state.cached ? " · cached" : ""}
    </span>
  );
}
