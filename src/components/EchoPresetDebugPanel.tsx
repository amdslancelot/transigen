"use client";

import type { CSSProperties } from "react";
import type { EchoPresetTickDebug } from "@/lib/transitionPresetTick";

function fmt(n: number, digits: number) {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n);
}

type Props = {
  snapshot: EchoPresetTickDebug | null;
};

/**
 * Live echo tick fields (written from `transitionPresetTickFrame` when sink is passed).
 */
export function EchoPresetDebugPanel({ snapshot }: Props) {
  const boxStyle: CSSProperties = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "0.72rem",
    lineHeight: 1.45,
    padding: "0.5rem 0.65rem",
    borderRadius: 6,
    border: "1px solid var(--border, #333)",
    background: "var(--surface-2, rgba(0,0,0,0.25))",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    maxHeight: 220,
    overflow: "auto",
  };

  if (snapshot == null) {
    return (
      <div style={boxStyle} className="muted" aria-label="Echo preset debug (idle)">
        Echo debug: no snapshot (preset not echo, before anchor, or idle).
      </div>
    );
  }

  const { p, nSeg, seeksCompleted, denom, stepCap, snippetMul, volA, volB } = snapshot;
  const text = [
    `p = ${fmt(p, 6)}`,
    `nSeg = ${nSeg}`,
    `seeksCompleted = ${seeksCompleted}`,
    `denom = ${denom}`,
    `stepCap = min(denom, seeksCompleted) = ${stepCap}`,
    `snippetMul = ${fmt(snippetMul, 6)}`,
    `pA.setVolume(Math.round(100 * snippetMul)) = ${volA}`,
    `pB.setVolume(Math.round(100 * p)) = ${volB}`,
  ].join("\n");

  return (
    <div style={boxStyle} aria-label="Echo preset debug">
      <strong style={{ display: "block", marginBottom: "0.35rem" }}>Echo preset debug</strong>
      {text}
    </div>
  );
}
