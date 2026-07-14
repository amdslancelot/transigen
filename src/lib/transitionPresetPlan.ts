export type PresetPlan =
  | { kind: "cut"; window: number; beatOffset: number }
  | { kind: "fade"; window: number; fadeSec: number; beatOffset: number }
  | { kind: "echo"; window: number; n: number; step: number; beatOffset: number }
  | { kind: "stutter"; window: number; n: number; step: number; beatOffset: number };

export function buildPresetPlan(
  code: string,
  bpm: number | null,
  fadeBars: 1 | 2 | 4 | null,
  beatOffset: number | null = null,
): PresetPlan {
  const beat = bpm != null && bpm > 0 ? 60 / bpm : 0.5;
  const bo = beatOffset ?? 0;
  switch (code) {
    case "hard_cut":
      return { kind: "cut", window: 0, beatOffset: bo };
    case "fade":
    case "fade_like": {
      const bars = fadeBars ?? 2;
      const fadeSec = bars * 4 * beat;
      return { kind: "fade", window: fadeSec, fadeSec, beatOffset: bo };
    }
    case "echo_8": {
      const step = beat / 2;
      return { kind: "echo", n: 8, step, window: 8 * step, beatOffset: bo };
    }
    case "echo_16": {
      const step = beat / 2;
      return { kind: "echo", n: 16, step, window: 16 * step, beatOffset: bo };
    }
    case "stutter_8": {
      const step = beat / 2;
      return { kind: "stutter", n: 8, step, window: 8 * step, beatOffset: bo };
    }
    case "stutter_4": {
      const step = beat / 2;
      return { kind: "stutter", n: 4, step, window: 4 * step, beatOffset: bo };
    }
    default:
      return { kind: "cut", window: 0, beatOffset: bo };
  }
}
