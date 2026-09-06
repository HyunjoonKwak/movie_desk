import { create } from "zustand";

export type PitchState = "rendering" | "ready" | "fallback";
export const usePitchState = create<{
  entries: Record<string, { key: string; state: PitchState }>;
}>(() => ({ entries: {} }));

export const setPitchState = (clipId: string, key: string, state?: PitchState): void => {
  usePitchState.setState(({ entries }) => {
    const next = { ...entries };
    if (state) next[clipId] = { key, state };
    else if (next[clipId]?.key === key) delete next[clipId];
    return { entries: next };
  });
};
