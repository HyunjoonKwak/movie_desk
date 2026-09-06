// Guidance and generation must use the same mode/tempo window when enumerating candidates.
import { MODE_PRESETS } from "./modes";
import type { EditMode } from "./types";

export function candidateWindowMs(mode: EditMode, bpm = 0): number {
  const preset = MODE_PRESETS[mode];
  const beatMs = bpm > 0 ? 60000 / bpm : preset.fallbackCutMs;
  return Math.max(1200, Math.round(preset.beatsMid * beatMs));
}
