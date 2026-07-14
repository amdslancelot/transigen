import type { YTPlayer } from "@/lib/youtubeIframeApi";
import { ECHO_STUTTER_SEEK_SLACK_SEC, snapEchoStutterAnchor } from "@/lib/transitionBeatGrid";
import { buildPresetPlan, type PresetPlan } from "@/lib/transitionPresetPlan";

/** YT.PlayerState — avoid calling playVideo again while B is already advancing (prevents restarts from cue). */
const YT_PLAYING = 1;
const YT_BUFFERING = 3;

function primeIncomingBForCrossfade(pB: YTPlayer) {
  try {
    pB.unMute();
    pB.setVolume(0);
    const getSt = pB.getPlayerState;
    if (typeof getSt === "function") {
      const st = getSt();
      if (st === YT_PLAYING || st === YT_BUFFERING) return;
    }
    pB.playVideo();
  } catch {
    try {
      pB.playVideo();
    } catch {
      /* noop */
    }
  }
}

export type TransitionTickState = {
  nextSeekAt: number;
  seeksLeft: number;
  fadeStarted: boolean;
  cutDone: boolean;
  /** Snapped seek-back target for echo/stutter; set in seedEchoStutterFromPlan. */
  echoStutterAnchor?: number;
  /** After `n` echo seeks (`k >= n`), mute outgoing A once (do not pause — `tA` must reach `endPrevSec`). */
  echoExhaustedMuteDone?: boolean;
};

export function createTransitionTickState(): TransitionTickState {
  return {
    nextSeekAt: 0,
    seeksLeft: 0,
    fadeStarted: false,
    cutDone: false,
    echoStutterAnchor: undefined,
    echoExhaustedMuteDone: undefined,
  };
}

export function seedEchoStutterFromPlan(
  tick: TransitionTickState,
  plan: PresetPlan,
  endPrevSec: number,
) {
  if (plan.kind === "echo" || plan.kind === "stutter") {
    tick.seeksLeft = plan.n;
    const windowLen = plan.window;
    const rawAnchor = Math.max(0, endPrevSec - windowLen);
    const snapped = snapEchoStutterAnchor(rawAnchor, plan.step, endPrevSec, plan.n, plan.beatOffset);
    tick.echoStutterAnchor = snapped;
    tick.nextSeekAt = snapped;
    tick.echoExhaustedMuteDone = undefined;
  }
}

export type EchoPresetTickDebug = {
  p: number;
  nSeg: number;
  seeksCompleted: number;
  denom: number;
  stepCap: number;
  snippetMul: number;
  volA: number;
  volB: number;
};

/** Optional ref written each frame when preset is echo and `tA >= anch`. */
export type EchoPresetTickDebugSink = { current: EchoPresetTickDebug | null };

/**
 * One RAF frame of preset-driven A/B behaviour (same semantics as /transition live preview).
 * Returns whether the edge should finish (hand off to B at startNextSec).
 */
export function transitionPresetTickFrame(
  pA: YTPlayer,
  pB: YTPlayer,
  tick: TransitionTickState,
  tA: number,
  endPrevSec: number,
  presetCode: string,
  bpm: number | null,
  fadeBars: 1 | 2 | 4 | null,
  echoDebugSink?: EchoPresetTickDebugSink | null,
): boolean {
  if (tick.cutDone) return false;
  if (tA >= endPrevSec) return true;

  const planNow = buildPresetPlan(presetCode, bpm, fadeBars);
  if (echoDebugSink && planNow.kind !== "echo") {
    echoDebugSink.current = null;
  }

  switch (planNow.kind) {
    case "cut":
      break;
    case "fade": {
      const fadeSec = planNow.fadeSec;
      const startFade = endPrevSec - fadeSec;
      if (tA >= startFade && !tick.fadeStarted) {
        tick.fadeStarted = true;
        primeIncomingBForCrossfade(pB);
      }
      if (tick.fadeStarted && tA >= startFade && tA < endPrevSec) {
        const p = Math.min(1, Math.max(0, (tA - startFade) / fadeSec));
        try {
          pA.setVolume(Math.round(100 * (1 - p)));
          pB.setVolume(Math.round(100 * p));
        } catch {
          /* noop */
        }
      }
      break;
    }
    case "echo": {
      const rawAnch = Math.max(0, endPrevSec - planNow.window);
      const anch = tick.echoStutterAnchor ?? snapEchoStutterAnchor(rawAnch, planNow.step, endPrevSec, planNow.n, planNow.beatOffset);
      const windowLen = planNow.window;

      if (tA < anch) {
        if (echoDebugSink) {
          echoDebugSink.current = null;
        }
        try {
          pA.unMute();
          pA.setVolume(100);
        } catch {
          /* noop */
        }
        break;
      }

      if (!tick.fadeStarted) {
        tick.fadeStarted = true;
        primeIncomingBForCrossfade(pB);
      }

      if (tick.seeksLeft > 0) {
        const firesDone = planNow.n - tick.seeksLeft;
        const threshold = anch + firesDone * planNow.step;
        if (tA + ECHO_STUTTER_SEEK_SLACK_SEC >= threshold) {
          try {
            pA.seekTo(anch, true);
          } catch {
            /* noop */
          }
          tick.seeksLeft--;
          tick.nextSeekAt = anch + (planNow.n - tick.seeksLeft) * planNow.step;
        }
      }

      const p = Math.min(1, Math.max(0, (tA - anch) / windowLen));
      const nSeg = planNow.n;
      const k = nSeg - tick.seeksLeft;
      const denom = Math.max(1, nSeg - 1);
      const stepCap = Math.min(denom, k);
      const snippetMul = (denom - stepCap) / denom;

      const volA = Math.round(100 * snippetMul);
      const volB = Math.round(100 * p);

      if (k >= nSeg && nSeg > 0 && !tick.echoExhaustedMuteDone) {
        tick.echoExhaustedMuteDone = true;
        try {
          pA.mute();
          pA.setVolume(0);
        } catch {
          /* noop */
        }
      }

      try {
        if (!tick.echoExhaustedMuteDone) {
          pA.setVolume(volA);
        }
        pB.setVolume(volB);
      } catch {
        /* noop */
      }

      if (echoDebugSink) {
        echoDebugSink.current = {
          p,
          nSeg,
          seeksCompleted: k,
          denom,
          stepCap,
          snippetMul,
          volA: tick.echoExhaustedMuteDone ? 0 : volA,
          volB,
        };
      }
      break;
    }
    case "stutter": {
      const rawAnch = Math.max(0, endPrevSec - planNow.window);
      const anch = tick.echoStutterAnchor ?? snapEchoStutterAnchor(rawAnch, planNow.step, endPrevSec, planNow.n, planNow.beatOffset);
      if (tick.seeksLeft > 0) {
        const firesDone = planNow.n - tick.seeksLeft;
        const threshold = anch + firesDone * planNow.step;
        if (tA + ECHO_STUTTER_SEEK_SLACK_SEC >= threshold) {
          try {
            pA.seekTo(anch, true);
          } catch {
            /* noop */
          }
          tick.seeksLeft--;
          tick.nextSeekAt = anch + (planNow.n - tick.seeksLeft) * planNow.step;
        }
      }
      try {
        pA.setVolume(100);
      } catch {
        /* noop */
      }
      break;
    }
  }

  return false;
}
