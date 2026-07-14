"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatMinSec } from "@/lib/timeInput";
import { EchoPresetDebugPanel } from "@/components/EchoPresetDebugPanel";
import type { PlaybackEdge } from "@/lib/roomPlaybackEdges";
import { finishHandoffToB, primeIncomingDeckMuted } from "@/lib/transitionHandoff";
import { buildPresetPlan } from "@/lib/transitionPresetPlan";
import {
  createTransitionTickState,
  seedEchoStutterFromPlan,
  transitionPresetTickFrame,
  type EchoPresetTickDebug,
  type TransitionTickState,
} from "@/lib/transitionPresetTick";
import { loadYoutubeIframeApi } from "@/lib/youtubeIframeApi";
import type { YTPlayer } from "@/lib/youtubeIframeApi";
import { fitPlaybackClock, type ClockSample } from "@/lib/playbackClock";

type Props = {
  edges: PlaybackEdge[];
  /** Room start track; preloaded on deck A when there are no chain edges yet. */
  startVideoId: string;
  /** Shown on deck B when there is no incoming YouTube track yet. */
  deckPlaceholderSrc?: string;
};

const END_EPS = 0.15;
const DEFAULT_DUR = 240;
const BETWEEN_EDGE_MS = 280;

function finishToB(pa: YTPlayer, pb: YTPlayer, startNextSec: number, tick: TransitionTickState) {
  tick.cutDone = true;
  finishHandoffToB(pa, pb, startNextSec);
}

export function RoomFullSetPlayer({ edges, startVideoId, deckPlaceholderSrc = "/dj-turntable.png" }: Props) {
  const baseId = useId().replace(/:/g, "");
  const id0 = `${baseId}-s0`;
  const id1 = `${baseId}-s1`;

  const slotsRef = useRef<[YTPlayer | null, YTPlayer | null]>([null, null]);
  const rafRef = useRef<number | null>(null);
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const edgeIdxRef = useRef(0);
  const playingRef = useRef(false);
  const tailModeRef = useRef(false);
  const tailSlotRef = useRef(0);
  const tailEndSecRef = useRef(DEFAULT_DUR);
  const tickRef = useRef<TransitionTickState>(createTransitionTickState());
  const echoDebugSinkRef = useRef<EchoPresetTickDebug | null>(null);
  const deckAClockSamplesRef = useRef<ClockSample[]>([]);
  const deckBClockSamplesRef = useRef<ClockSample[]>([]);

  const [playersReady, setPlayersReady] = useState(false);
  const [phase, setPhase] = useState<"idle" | "playing" | "done">("idle");
  const [uiEdgeIdx, setUiEdgeIdx] = useState(0);
  const [tA, setTA] = useState(0);
  const [tB, setTB] = useState(0);
  const [modeLabel, setModeLabel] = useState("");
  const [echoDebugSnapshot, setEchoDebugSnapshot] = useState<EchoPresetTickDebug | null>(null);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const completeAll = useCallback(() => {
    playingRef.current = false;
    tailModeRef.current = false;
    stopRaf();
    try {
      slotsRef.current[0]?.pauseVideo();
      slotsRef.current[1]?.pauseVideo();
    } catch {
      /* noop */
    }
    setPhase("done");
    setModeLabel("Finished");
    setEchoDebugSnapshot(null);
  }, [stopRaf]);

  const tailTick = useCallback(() => {
    if (!playingRef.current || !tailModeRef.current) return;
    const p = slotsRef.current[tailSlotRef.current];
    if (!p) return;
    let t = 0;
    let dur = 0;
    try {
      t = p.getCurrentTime();
      dur = p.getDuration();
    } catch {
      rafRef.current = requestAnimationFrame(tailTick);
      return;
    }
    setTA(t);
    const cap = tailEndSecRef.current > 0 ? tailEndSecRef.current : DEFAULT_DUR;
    const end = dur > 1 ? Math.min(dur, cap) : cap;
    if (t >= end - END_EPS) {
      completeAll();
      return;
    }
    rafRef.current = requestAnimationFrame(tailTick);
  }, [completeAll]);

  const startTail = useCallback(
    (bPhysicalSlot: number) => {
      tailModeRef.current = true;
      tailSlotRef.current = bPhysicalSlot;
      const list = edgesRef.current;
      const last = list[list.length - 1];
      tailEndSecRef.current = last?.durationB ?? DEFAULT_DUR;
    setModeLabel("Outro (last song)");
    setEchoDebugSnapshot(null);
    rafRef.current = requestAnimationFrame(tailTick);
    },
    [tailTick],
  );

  const edgeLoopRef = useRef<() => void>(() => {});

  const edgeLoop = useCallback(() => {
    if (!playingRef.current || tailModeRef.current) return;
    const list = edgesRef.current;
    const idx = edgeIdxRef.current;
    if (idx >= list.length) return;

    const edge = list[idx];
    const aSlot = idx % 2;
    const bSlot = 1 - aSlot;
    const pA = slotsRef.current[aSlot];
    const pB = slotsRef.current[bSlot];
    if (!pA || !pB || tickRef.current.cutDone) return;

    let tAv = 0;
    let tBv = 0;
    try {
      const rawA = pA.getCurrentTime();
      const nowA = performance.now();
      const samplesA = [...deckAClockSamplesRef.current, { wallMs: nowA, playerSec: rawA }].slice(-10);
      deckAClockSamplesRef.current = samplesA;
      tAv = samplesA.length >= 2 ? fitPlaybackClock(samplesA)(nowA) : rawA;

      const rawB = pB.getCurrentTime();
      const nowB = performance.now();
      const samplesB = [...deckBClockSamplesRef.current, { wallMs: nowB, playerSec: rawB }].slice(-10);
      deckBClockSamplesRef.current = samplesB;
      tBv = samplesB.length >= 2 ? fitPlaybackClock(samplesB)(nowB) : rawB;
    } catch {
      rafRef.current = requestAnimationFrame(() => edgeLoopRef.current());
      return;
    }

    setTA(tAv);
    setTB(tBv);

    const echoPreset = buildPresetPlan(edge.presetCode, edge.bpm, edge.fadeBars, edge.beat_offset).kind === "echo";
    const shouldFinish = transitionPresetTickFrame(
      pA,
      pB,
      tickRef.current,
      tAv,
      edge.endPrevSec,
      edge.presetCode,
      edge.bpm,
      edge.fadeBars,
      echoPreset ? echoDebugSinkRef : undefined,
    );
    if (echoPreset) {
      setEchoDebugSnapshot(echoDebugSinkRef.current);
    } else {
      setEchoDebugSnapshot(null);
    }

    if (shouldFinish) {
      stopRaf();
      deckAClockSamplesRef.current = [];
      deckBClockSamplesRef.current = [];
      finishToB(pA, pB, edge.startNextSec, tickRef.current);

      const next = idx + 1;
      edgeIdxRef.current = next;

      if (next >= list.length) {
        startTail(bSlot);
        return;
      }

      const nextEdge = list[next];
      const nb = 1 - (next % 2);
      const pb = slotsRef.current[nb];
      if (!pb) return;
      primeIncomingDeckMuted(pb, nextEdge.videoIdB, nextEdge.startNextSec);

      window.setTimeout(() => {
        if (!playingRef.current) return;
        tickRef.current = createTransitionTickState();
        const plan2 = buildPresetPlan(nextEdge.presetCode, nextEdge.bpm, nextEdge.fadeBars, nextEdge.beat_offset);
        seedEchoStutterFromPlan(tickRef.current, plan2, nextEdge.endPrevSec);
        tickRef.current.cutDone = false;
        setUiEdgeIdx(next);
        setModeLabel(`Transition ${next + 1} / ${list.length}`);

        const na = next % 2;
        const paNext = slotsRef.current[na];
        if (paNext) {
          try {
            paNext.loadVideoById({ videoId: nextEdge.videoIdA, startSeconds: 0 });
            paNext.unMute();
            paNext.setVolume(100);
            paNext.seekTo(0, true);
            paNext.playVideo();
          } catch {
            /* noop */
          }
        }

        rafRef.current = requestAnimationFrame(() => edgeLoopRef.current());
      }, BETWEEN_EDGE_MS);
      return;
    }

    rafRef.current = requestAnimationFrame(() => edgeLoopRef.current());
  }, [startTail, stopRaf]);

  edgeLoopRef.current = edgeLoop;

  useEffect(() => {
    let cancelled = false;
    let r0 = false;
    let r1 = false;
    slotsRef.current = [null, null];
    setPlayersReady(false);
    setPhase("idle");
    edgeIdxRef.current = 0;
    tailModeRef.current = false;
    stopRaf();

    const origin =
      typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : undefined;

    const common = {
      height: 220,
      width: "100%",
      playerVars: {
        enablejsapi: 1,
        playsinline: 1,
        rel: 0,
        ...(origin ? { origin } : {}),
      },
    };

    if (edges.length === 0) {
      if (!startVideoId) {
        return () => {
          cancelled = true;
        };
      }

      void loadYoutubeIframeApi()
        .then((YT) => {
          if (cancelled) return;
          new YT.Player(id0, {
            ...common,
            videoId: startVideoId,
            events: {
              onReady: (ev: { target: YTPlayer }) => {
                if (cancelled) return;
                slotsRef.current[0] = ev.target;
                r0 = true;
                try {
                  ev.target.cueVideoById({ videoId: startVideoId, startSeconds: 0 });
                  ev.target.pauseVideo();
                  ev.target.seekTo(0, true);
                } catch {
                  /* noop */
                }
                if (r0) setPlayersReady(true);
              },
            },
          });
        })
        .catch(() => {
          /* leave not ready */
        });

      return () => {
        cancelled = true;
        stopRaf();
        playingRef.current = false;
        try {
          slotsRef.current[0]?.destroy();
        } catch {
          /* noop */
        }
        slotsRef.current = [null, null];
      };
    }

    const e0 = edges[0];
    void loadYoutubeIframeApi()
      .then((YT) => {
        if (cancelled) return;

        new YT.Player(id0, {
          ...common,
          videoId: e0.videoIdA,
          events: {
            onReady: (ev: { target: YTPlayer }) => {
              if (cancelled) return;
              slotsRef.current[0] = ev.target;
              r0 = true;
              if (r0 && r1) setPlayersReady(true);
            },
          },
        });

        new YT.Player(id1, {
          ...common,
          videoId: e0.videoIdB,
          events: {
            onReady: (ev: { target: YTPlayer }) => {
              if (cancelled) return;
              slotsRef.current[1] = ev.target;
              r1 = true;
              if (r0 && r1) setPlayersReady(true);
            },
          },
        });
      })
      .catch(() => {
        /* leave not ready */
      });

    return () => {
      cancelled = true;
      stopRaf();
      playingRef.current = false;
      try {
        slotsRef.current[0]?.destroy();
        slotsRef.current[1]?.destroy();
      } catch {
        /* noop */
      }
      slotsRef.current = [null, null];
    };
  }, [edges, startVideoId, id0, id1, stopRaf]);

  const handlePlay = useCallback(() => {
    const s0 = slotsRef.current[0];
    const s1 = slotsRef.current[1];
    if (!s0 || !s1 || edgesRef.current.length < 1) return;

    playingRef.current = true;
    tailModeRef.current = false;
    edgeIdxRef.current = 0;
    setPhase("playing");
    setTA(0);
    setTB(0);

    const e0 = edgesRef.current[0];
    tickRef.current = createTransitionTickState();
    const plan = buildPresetPlan(e0.presetCode, e0.bpm, e0.fadeBars, e0.beat_offset);
    seedEchoStutterFromPlan(tickRef.current, plan, e0.endPrevSec);
    tickRef.current.cutDone = false;
    setUiEdgeIdx(0);
    setModeLabel(`Transition 1 / ${edgesRef.current.length}`);
    setEchoDebugSnapshot(null);

    try {
      s0.loadVideoById({ videoId: e0.videoIdA, startSeconds: 0 });
      s1.loadVideoById({ videoId: e0.videoIdB, startSeconds: e0.startNextSec });
    } catch {
      /* noop */
    }

    window.setTimeout(() => {
      if (!playingRef.current) return;
      try {
        s0.unMute();
        s0.setVolume(100);
        s0.seekTo(0, true);
        primeIncomingDeckMuted(s1, e0.videoIdB, e0.startNextSec);
        s0.playVideo();
      } catch {
        /* noop */
      }
      rafRef.current = requestAnimationFrame(() => edgeLoopRef.current());
    }, 120);
  }, []);

  const handlePause = useCallback(() => {
    playingRef.current = false;
    tailModeRef.current = false;
    stopRaf();
    try {
      slotsRef.current[0]?.pauseVideo();
      slotsRef.current[1]?.pauseVideo();
    } catch {
      /* noop */
    }
    setPhase("idle");
    setModeLabel("Paused");
    setEchoDebugSnapshot(null);
  }, [stopRaf]);

  const handleReset = useCallback(() => {
    playingRef.current = false;
    tailModeRef.current = false;
    stopRaf();
    edgeIdxRef.current = 0;
    tickRef.current = createTransitionTickState();
    setPhase("idle");
    setUiEdgeIdx(0);
    setTA(0);
    setTB(0);
    setModeLabel("");
    setEchoDebugSnapshot(null);

    const list = edgesRef.current;
    if (list.length === 0) {
      const s0only = slotsRef.current[0];
      try {
        s0only?.cueVideoById({ videoId: startVideoId, startSeconds: 0 });
        s0only?.pauseVideo();
        s0only?.seekTo(0, true);
      } catch {
        /* noop */
      }
      return;
    }
    const e0 = list[0];
    const s0 = slotsRef.current[0];
    const s1 = slotsRef.current[1];
    try {
      s0?.loadVideoById({ videoId: e0.videoIdA, startSeconds: 0 });
      s1?.loadVideoById({ videoId: e0.videoIdB, startSeconds: e0.startNextSec });
      s0?.pauseVideo();
      s1?.pauseVideo();
      s0?.seekTo(0, true);
      s1?.mute();
      s1?.setVolume(0);
    } catch {
      /* noop */
    }
  }, [startVideoId, stopRaf]);

  const cur = edges.length > 0 ? (edges[uiEdgeIdx] ?? edges[0]) : undefined;
  const aSlot = uiEdgeIdx % 2;

  const chainReady = edges.length > 0;
  const hasStartDeck = chainReady || startVideoId.length > 0;
  const pauseDisabled = !playersReady || phase !== "playing";

  return (
    <div className="col" style={{ gap: "0.75rem" }}>
      <p className="muted">
        Full-set playback uses the same fade / echo / stutter timing as the transition preview. YouTube seek timing
        is still approximate between segments.
        {!chainReady ? " Add songs from saved transitions below to enable the full chain." : null}
      </p>
      <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={handlePlay}
          disabled={!playersReady || phase === "playing" || !chainReady}
        >
          Play full set
        </button>
        <button type="button" className="secondary" onClick={handlePause} disabled={pauseDisabled}>
          Pause
        </button>
        <button type="button" className="secondary" onClick={handleReset} disabled={!playersReady && !hasStartDeck}>
          Reset
        </button>
        {!playersReady && hasStartDeck ? <span className="muted">Loading players…</span> : null}
        {!hasStartDeck ? <span className="muted">No room start video.</span> : null}
        {phase === "done" ? <span className="pill">Done</span> : null}
      </div>
      {modeLabel ? (
        <p>
          <strong>{modeLabel}</strong>
        </p>
      ) : null}
      {chainReady && cur ? (
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
          <span className="muted">
            Slot {aSlot === 0 ? "A" : "B"} (outgoing): t={formatMinSec(tA)} · end {formatMinSec(cur.endPrevSec)}
          </span>
          <span className="muted">
            Incoming: t={formatMinSec(tB)} · cue {formatMinSec(cur.startNextSec)}
          </span>
        </div>
      ) : (
        <p className="muted">
          Player 1 preloads the room start track. Player 2 shows a deck placeholder until your set has a first
          incoming song.
        </p>
      )}
      <div className="row" style={{ alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
        <div className="col" style={{ flex: "1 1 200px" }}>
          <strong>Player 1</strong>
          {hasStartDeck ? <div id={id0} /> : <p className="muted">Add a start video when creating the room.</p>}
        </div>
        <div className="col" style={{ flex: "1 1 200px" }}>
          <strong>Player 2</strong>
          {chainReady ? (
            <div id={id1} />
          ) : (
            <div
              className="row"
              style={{
                minHeight: 220,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                border: "1px solid var(--border, #333)",
                padding: "0.5rem",
              }}
            >
              <Image
                src={deckPlaceholderSrc}
                alt=""
                width={280}
                height={220}
                style={{ width: "100%", maxWidth: 280, height: "auto", objectFit: "contain" }}
              />
            </div>
          )}
        </div>
        {chainReady && cur && buildPresetPlan(cur.presetCode, cur.bpm, cur.fadeBars, cur.beat_offset).kind === "echo" ? (
          <div className="col" style={{ flex: "0 1 280px", minWidth: 220, maxWidth: "100%" }}>
            <EchoPresetDebugPanel snapshot={echoDebugSnapshot} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
