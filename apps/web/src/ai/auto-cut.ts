import type { ID, Project, MediaClip } from "@movie-desk/core";
import { isMediaClip, splitClipAt, removeClip } from "@movie-desk/core";
import type { Range } from "./types";

// Convert silence ranges (within an asset's source time domain) into a
// sequence of split + remove operations on the timeline clips that reference
// that asset. Returns the resulting project state.
export const removeSilentRangesFromClip = (
  project: Project,
  clipId: ID,
  silentRangesMs: readonly Range[],
): Project => {
  let next = project;
  const clip = findClipById(next, clipId);
  if (!clip || !isMediaClip(clip)) return next;

  // Translate source-time silence ranges into timeline-time ranges, clipped
  // to the visible portion of this clip.
  const timelineRanges = silentRangesMs
    .map((r) => sourceToTimeline(clip, r))
    .filter((r): r is Range => r !== null);

  // Sort descending so earlier splits don't shift the indexes of later ones.
  timelineRanges.sort((a, b) => b.start - a.start);

  for (const r of timelineRanges) {
    const c = findFirstClipCovering(next, clipId, r.start);
    if (!c) continue;
    // Split at end first so the middle slice becomes its own clip,
    // then split at start, then remove the middle.
    next = splitClipAt(next, c.id, r.end);
    const after = findFirstClipCovering(next, clipId, r.start);
    if (!after) continue;
    next = splitClipAt(next, after.id, r.start);
    const middle = findFirstClipBetween(next, clipId, r.start, r.end);
    if (middle) next = removeClip(next, middle.id);
  }
  return next;
};

const findClipById = (project: Project, id: ID) => {
  for (const t of project.timeline.tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
};

const findFirstClipCovering = (project: Project, assetClipBaseId: ID, t: number) => {
  // After splits, the original clip has spawned siblings with new ids — we
  // can't filter by the original id. Pick any clip on the same track that
  // covers `t`. Track lookup goes through whichever clip currently has the
  // original id (still on that track).
  const home = findHomeTrack(project, assetClipBaseId);
  if (!home) return undefined;
  return home.clips.find((c) => t >= c.start && t < c.start + c.duration);
};

const findFirstClipBetween = (
  project: Project,
  assetClipBaseId: ID,
  startMs: number,
  endMs: number,
) => {
  const home = findHomeTrack(project, assetClipBaseId);
  if (!home) return undefined;
  return home.clips.find((c) => c.start >= startMs && c.start + c.duration <= endMs);
};

const findHomeTrack = (project: Project, originalId: ID) => {
  for (const t of project.timeline.tracks) {
    if (t.clips.some((c) => c.id === originalId)) return t;
  }
  // After all splits, the original id is gone. Fall back to the primary
  // video track — never tracks[0] blindly, which is where subtitle/title
  // lanes now live (silence removal must not split caption clips).
  return project.timeline.tracks.find((t) => t.kind === "video" && !t.connected);
};

// Map a silence range expressed in the source asset's time domain to the
// project timeline. Returns null if the silence falls outside the clip's
// trimmed portion.
const sourceToTimeline = (clip: MediaClip, r: Range): Range | null => {
  const clipStartSrc = clip.trimIn;
  const clipEndSrc = clip.trimIn + clip.duration / clip.speed;
  const start = Math.max(r.start, clipStartSrc);
  const end = Math.min(r.end, clipEndSrc);
  if (end <= start) return null;
  return {
    start: clip.start + (start - clipStartSrc) * clip.speed,
    end: clip.start + (end - clipStartSrc) * clip.speed,
  };
};
