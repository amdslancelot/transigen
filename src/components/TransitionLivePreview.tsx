"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatMinSec } from "@/lib/timeInput";
import { EchoPresetDebugPanel } from "@/components/EchoPresetDebugPanel";
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
import type { YTNamespace, YTPlayer } from "@/lib/youtubeIframeApi";
import { WaveformLikeVisualizer } from "./WaveformLikeVisualizer";

type Props = {
  videoIdA?: string;
  videoIdB?: string;
  durationA: number | null;
  durationB: number | null;
  endPrevSec: number;
  startNextSec: number;
  presetCode: string;
  bpm: number | null;
  fadeBars: 1 | 2 | 4 | null;
  readyToPreview: boolean;
};

export function TransitionLivePreview({
  videoIdA,
  videoIdB,
  durationA,
  durationB,
  endPrevSec,
  startNextSec,
  presetCode,
  bpm,
  fadeBars,
  readyToPreview,
}: Props) {
  const baseId = useId().replace(/:/g, "");
  const idA = `${baseId}-wrap-a`;
  const idB = `${baseId}-wrap-b`;

  const playerARef = useRef<YTPlayer | null>(null);
  const playerBRef = useRef<YTPlayer | null>(null);
  const ytRef = useRef<YTNamespace | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<TransitionTickState>(createTransitionTickState());
  const echoDebugSinkRef = useRef<EchoPresetTickDebug | null>(null);

  const [playersReady, setPlayersReady] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [tDisplayA, setTDisplayA] = useState(0);
  const [tDisplayB, setTDisplayB] = useState(0);
  const [echoDebugSnapshot, setEchoDebugSnapshot] = useState<EchoPresetTickDebug | null>(null);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const finishToB = useCallback(() => {
    const pa = playerARef.current;
    const pb = playerBRef.current;
    tickRef.current.cutDone = true;
    stopRaf();
    finishHandoffToB(pa, pb, startNextSec);
    setPhase("done");
  }, [startNextSec, stopRaf]);

  useEffect(() => {
    let cancelled = false;
    let readyA = false;
    let readyB = false;

    function trySetReady() {
      if (!cancelled && readyA && readyB) setPlayersReady(true);
    }

    playerARef.current = null;
    playerBRef.current = null;
    setPlayersReady(false);
    setPhase("idle");
    tickRef.current = createTransitionTickState();
    setEchoDebugSnapshot(null);

    if (!videoIdA || !videoIdB) {
      return;
    }

    const origin =
      typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : undefined;

    loadYoutubeIframeApi()
      .then((YT) => {
        if (cancelled) return;
        ytRef.current = YT;

        new YT.Player(idA, {
          videoId: videoIdA,
          height: 220,
          width: "100%",
          playerVars: {
            enablejsapi: 1,
            playsinline: 1,
            rel: 0,
            ...(origin ? { origin } : {}),
          },
          events: {
            onReady: (e: { target: YTPlayer }) => {
              if (cancelled) return;
              playerARef.current = e.target;
              readyA = true;
              trySetReady();
            },
          },
        });

        new YT.Player(idB, {
          videoId: videoIdB,
          height: 220,
          width: "100%",
          playerVars: {
            enablejsapi: 1,
            playsinline: 1,
            rel: 0,
            ...(origin ? { origin } : {}),
          },
          events: {
            onReady: (e: { target: YTPlayer }) => {
              if (cancelled) return;
              playerBRef.current = e.target;
              readyB = true;
              trySetReady();
            },
          },
        });
      })
      .catch(() => {
        /* Player creation failed — leave playersReady false */
      });

    return () => {
      cancelled = true;
      stopRaf();
      try {
        playerARef.current?.destroy();
        playerBRef.current?.destroy();
      } catch {
        /* noop */
      }
      playerARef.current = null;
      playerBRef.current = null;
    };
  }, [idA, idB, stopRaf, videoIdA, videoIdB]);

  const handleReset = useCallback(() => {
    stopRaf();
    const pa = playerARef.current;
    const pb = playerBRef.current;
    try {
      pa?.pauseVideo();
      pa?.seekTo(0, true);
      pa?.setVolume(100);
      pb?.pauseVideo();
      if (videoIdB) pb?.cueVideoById({ videoId: videoIdB, startSeconds: startNextSec });
      pb?.mute();
      pb?.setVolume(0);
    } catch {
      /* noop */
    }
    setPhase("idle");
    tickRef.current = createTransitionTickState();
    setEchoDebugSnapshot(null);
    setTDisplayA(0);
    setTDisplayB(0);
  }, [stopRaf, startNextSec, videoIdB]);

  const handlePlayPreview = useCallback(() => {
    const pa = playerARef.current;
    const pb = playerBRef.current;
    if (!pa || !pb || !videoIdB || !readyToPreview) return;

    stopRaf();
    tickRef.current = createTransitionTickState();
    setEchoDebugSnapshot(null);

    const plan = buildPresetPlan(presetCode, bpm, fadeBars);
    seedEchoStutterFromPlan(tickRef.current, plan, endPrevSec);

    try {
      pa.unMute();
      pa.setVolume(100);
      pa.seekTo(0, true);

      primeIncomingDeckMuted(pb, videoIdB, startNextSec);

      pa.playVideo();
    } catch {
      /* noop */
    }

    setPhase("running");

    const tick = () => {
      const pA = playerARef.current;
      const pB = playerBRef.current;
      if (!pA || !pB || tickRef.current.cutDone) return;

      let tA = 0;
      let tB = 0;
      try {
        tA = pA.getCurrentTime();
        tB = pB.getCurrentTime();
      } catch {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      setTDisplayA(tA);
      setTDisplayB(tB);

      const echoPreset = buildPresetPlan(presetCode, bpm, fadeBars).kind === "echo";
      const shouldFinish = transitionPresetTickFrame(
        pA,
        pB,
        tickRef.current,
        tA,
        endPrevSec,
        presetCode,
        bpm,
        fadeBars,
        echoPreset ? echoDebugSinkRef : undefined,
      );
      if (echoPreset) {
        setEchoDebugSnapshot(echoDebugSinkRef.current);
      } else {
        setEchoDebugSnapshot(null);
      }
      if (shouldFinish) {
        finishToB();
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [
    bpm,
    endPrevSec,
    fadeBars,
    finishToB,
    presetCode,
    readyToPreview,
    startNextSec,
    stopRaf,
    videoIdB,
  ]);

  const showPlayers = Boolean(videoIdA && videoIdB);

  return (
    <div className="col" style={{ gap: "0.75rem" }}>
      <p className="muted">
        YouTube embed timing is approximate (seek jitter). Click Play preview once; browsers require a tap before
        audio can start on the second player.
      </p>
      <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <button type="button" onClick={handlePlayPreview} disabled={!playersReady || !readyToPreview}>
          Play preview
        </button>
        <button type="button" className="secondary" onClick={handleReset} disabled={!playersReady}>
          Reset
        </button>
        {!playersReady && showPlayers ? <span className="muted">Loading players…</span> : null}
        {phase === "done" ? <span className="pill">Cut complete</span> : null}
      </div>
      <div className="row" style={{ alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
        <div className="col" style={{ flex: "1 1 200px", gap: "0.35rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Song A</strong>
            <span className="muted">
              t={formatMinSec(tDisplayA)}
              {durationA != null ? ` / ${formatMinSec(durationA)}` : ""}
            </span>
          </div>
          <div id={idA} />
          <WaveformLikeVisualizer
            currentSec={tDisplayA}
            durationSec={durationA ?? Math.max(1, endPrevSec)}
            label="Song A waveform"
          />
        </div>
        <div className="col" style={{ flex: "1 1 200px", gap: "0.35rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Song B</strong>
            <span className="muted">
              t={formatMinSec(tDisplayB)}
              {durationB != null ? ` / ${formatMinSec(durationB)}` : ""}
            </span>
          </div>
          <div id={idB} />
          <WaveformLikeVisualizer
            currentSec={tDisplayB}
            durationSec={durationB ?? Math.max(1, startNextSec)}
            label="Song B waveform"
          />
        </div>
        {buildPresetPlan(presetCode, bpm, fadeBars).kind === "echo" && showPlayers ? (
          <div className="col" style={{ flex: "0 1 280px", minWidth: 220, maxWidth: "100%" }}>
            <EchoPresetDebugPanel snapshot={echoDebugSnapshot} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
