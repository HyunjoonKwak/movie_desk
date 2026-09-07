// Shared, non-exported helpers used by every mutate-* module. Keeping them
// in one place avoids drift between the slices and makes the public API in
// each slice file easier to scan.

import type { Project, Timeline } from "../model/project";
import type { Track } from "../model/track";
import { replaceTimeline } from "../model/project-timelines";
import { findTimeline, computeDuration } from "./query";

interface TrackReplacement {
  readonly project: Project;
  readonly timelineId: Timeline["id"];
}

// Both common mutation gateways keep the root alias and collection in sync.
export const replaceTrack = (
  project: Project,
  updated: Track,
  timelineId = project.rootTimelineId,
): TrackReplacement => {
  const timeline = findTimeline(project, timelineId);
  if (!timeline) throw new Error(`Unknown timeline: ${timelineId}`);
  return {
    project: replaceTimeline(project, {
      ...timeline,
      tracks: timeline.tracks.map((track) => (track.id === updated.id ? updated : track)),
    }),
    timelineId,
  };
};

// A replacement carries its target through composition; plain legacy edits
// still default to the root until their call sites migrate in Phase 1.
export const recompute = (input: Project | TrackReplacement, explicit?: Timeline): Project => {
  const project = "project" in input ? input.project : input;
  const timeline =
    "project" in input ? findTimeline(project, input.timelineId) : (explicit ?? project.timeline);
  if (!timeline) throw new Error("Missing recompute timeline");
  return replaceTimeline(
    { ...project, updatedAt: Date.now() },
    { ...timeline, duration: computeDuration(timeline) },
  );
};

// Returns a copy of `o` with key `k` stripped. Required by
// `exactOptionalPropertyTypes` so callers don't assign `undefined`.
export const dropKey = <T, K extends keyof T>(o: T, k: K): Omit<T, K> => {
  const { [k]: _drop, ...rest } = o;
  return rest as Omit<T, K>;
};
