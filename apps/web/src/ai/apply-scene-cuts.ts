import { splitClipAt, type ID, type MediaClip, type Project } from "@movie-desk/core";
import type { SceneCut } from "./types";

// Apply detected scene cuts (in source-relative ms) to a media clip by
// splitting it at each boundary that falls inside the clip's trimmed range.
export const applySceneCuts = (
  project: Project,
  rootClipId: ID,
  rootClip: MediaClip,
  cuts: readonly SceneCut[],
): Project => {
  let next = project;
  const srcStart = rootClip.trimIn;
  const srcEnd = rootClip.trimIn + rootClip.duration / rootClip.speed;

  // Translate to timeline-relative ms, then apply in descending order so
  // earlier splits don't invalidate later ones.
  const timelineCuts = cuts
    .map((c) => c.atMs)
    .filter((t) => t > srcStart && t < srcEnd)
    .map((t) => rootClip.start + (t - srcStart) * rootClip.speed)
    .sort((a, b) => b - a);

  for (const at of timelineCuts) {
    const home = next.timeline.tracks.find((t) => t.clips.some((c) => c.id === rootClipId));
    if (!home) continue;
    // After splits, rootClipId still names the *left* slice; subsequent splits
    // hit whichever clip currently spans `at`.
    const covering = home.clips.find((c) => at > c.start && at < c.start + c.duration);
    if (!covering) continue;
    next = splitClipAt(next, covering.id, at);
  }
  return next;
};
