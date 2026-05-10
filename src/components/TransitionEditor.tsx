"use client";

import { useMemo } from "react";
import type { TransitionPreset } from "@/types/db";

type Props = {
  presets: TransitionPreset[];
};

export function TransitionEditor({ presets }: Props) {
  const options = useMemo(() => presets ?? [], [presets]);

  return (
    <>
      <div className="row">
        <div className="col" style={{ flex: 1 }}>
          <label htmlFor="endPrevSec">End timestamp of song A (sec)</label>
          <input id="endPrevSec" name="endPrevSec" type="number" min={0} placeholder="e.g. 45" />
        </div>
        <div className="col" style={{ flex: 1 }}>
          <label htmlFor="startNextSec">Start timestamp of song B (sec)</label>
          <input
            id="startNextSec"
            name="startNextSec"
            type="number"
            min={0}
            placeholder="e.g. 16"
          />
        </div>
      </div>
      <div className="row">
        <div className="col" style={{ flex: 1 }}>
          <label htmlFor="presetId">Transition preset label (optional)</label>
          <select id="presetId" name="presetId" defaultValue="">
            <option value="">No preset</option>
            {options.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
        <div className="col" style={{ flex: 2 }}>
          <label htmlFor="note">Notes (optional)</label>
          <input id="note" name="note" placeholder="Why this transition works well..." />
        </div>
      </div>
    </>
  );
}
