export type PresetPlan =
  | { kind: "cut"; window: number }
  | { kind: "fade"; window: number; fadeSec: number }
  | { kind: "echo"; window: number; n: number; step: number }
  | { kind: "stutter"; window: number; n: number; step: number };

export function buildPresetPlan(
  code: string,
  bpm: number | null,
  fadeBars: 1 | 2 | 4 | null,
): PresetPlan {
  const beat = bpm != null && bpm > 0 ? 60 / bpm : 0.5;
  switch (code) {
    case "hard_cut":
      return { kind: "cut", window: 0 };
    case "fade":
    case "fade_like": {
      const bars = fadeBars ?? 2;
      const fadeSec = bars * 4 * beat;
      return { kind: "fade", window: fadeSec, fadeSec };
    }
    case "echo_8": {
      const step = beat / 2;
      return { kind: "echo", n: 8, step, window: 8 * step };
    }
    case "echo_16": {
      const step = beat / 2;
      return { kind: "echo", n: 16, step, window: 16 * step };
    }
    case "stutter_8": {
      const step = beat / 2;
      return { kind: "stutter", n: 8, step, window: 8 * step };
    }
    case "stutter_4": {
      const step = beat / 2;
      return { kind: "stutter", n: 4, step, window: 4 * step };
    }
    default:
      return { kind: "cut", window: 0 };
  }
}
