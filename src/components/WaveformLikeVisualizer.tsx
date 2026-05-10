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
      <div
        style={{
          height: 48,
          border: "1px solid #2a2f3a",
          borderRadius: 10,
          overflow: "hidden",
          position: "relative",
          background:
            "repeating-linear-gradient(90deg,#253045 0,#253045 3px,#182031 3px,#182031 8px)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${progress}%`,
            background: "linear-gradient(90deg, rgba(59,130,246,0.25), rgba(59,130,246,0.65))",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${progress}%`,
            width: 2,
            background: "#93c5fd",
          }}
        />
      </div>
    </div>
  );
}
