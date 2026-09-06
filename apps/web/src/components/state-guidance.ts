import type { Track } from "@movie-desk/core";

export function mediaGuidance(total: number, shown: number) {
  return total === 0 ? "empty" : shown === 0 ? "filtered" : null;
}

export function timelineGuidance(tracks: readonly Track[], selected: ReadonlySet<string>) {
  const clips = tracks.flatMap((track) => track.clips);
  const count = clips.filter((clip) => selected.has(clip.id)).length;
  const locked = tracks.some((track) => track.locked);
  return {
    state: clips.length === 0 ? "empty" : count === 0 ? "unselected" : "selected",
    count,
    locked,
  } as const;
}

export function analysisGuidance(
  total: number,
  running: boolean,
  settled: boolean,
  candidateCount: number,
) {
  if (total === 0) return "empty";
  if (running) return "running";
  if (!settled) return "before";
  return candidateCount <= 0 ? "noCandidates" : null;
}
