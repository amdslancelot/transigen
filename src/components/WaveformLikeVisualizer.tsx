"use client";

type Props = {
  currentSec: number;
  durationSec: number;
  label: string;
};

export function WaveformLikeVisualizer({ currentSec, durationSec, label }: Props) {
  const safeDuration = Math.max(1, durationSec);
  const progress = Math.min(100, Math.max(0, (currentSec / safeDuration) * 100));

  return (
    <div className="col" style={{ gap: "0.35rem" }}>
      <span className="muted" style={{ fontSize: "0.85rem" }}>
        {label}
      </span>
      {/*
       * Level-meter look that adapts to its surroundings: the base stays
       * transparent (deep on a .hardware panel, light on a cream panel) and the
       * fine vertical ticks are drawn from the inherited text color, so the
       * same markup reads as cream pinstripes on dark gear and ink pinstripes
       * on light panels.
       */}
      <div
        style={{
          height: 48,
          border: "1px solid color-mix(in srgb, currentColor 30%, transparent)",
          borderRadius: 10,
          overflow: "hidden",
          position: "relative",
          background:
            "repeating-linear-gradient(90deg, color-mix(in srgb, currentColor 16%, transparent) 0 1px, transparent 1px 6px)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${progress}%`,
            background:
              "linear-gradient(90deg, color-mix(in srgb, var(--accent) 35%, transparent), color-mix(in srgb, var(--accent-strong) 70%, transparent))",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${progress}%`,
            width: 2,
            background: "var(--accent-strong)",
          }}
        />
      </div>
    </div>
  );
}
