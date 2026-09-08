import { syncRootTimeline } from "../model/project-timelines";
import type { Project } from "../model/project";
import { hasSourceTrim, type Clip } from "../model/clip";
import { clipEnd } from "../model/clip";
import type { ID } from "../utils/id";
import { newId } from "../utils/id";
import type { Ms } from "../utils/time";
import { snapMsToFrame } from "../utils/time";

// Razor-tool split: cut the clip at `at` into two siblings within the same track.
// Returns the project unchanged if `at` is outside the clip.
export const splitClipAt = (project: Project, clipId: ID, at: Ms): Project => {
  let touched = false;
  const splitMs = snapMsToFrame(at, project.framerate);

  const tracks = project.timeline.tracks.map((track) => {
    const idx = track.clips.findIndex((c) => c.id === clipId);
    if (idx < 0) return track;
    const original = track.clips[idx];
    if (!original) return track;
    const end = clipEnd(original);
    if (splitMs <= original.start || splitMs >= end) return track;

    touched = true;
    const left: Clip = { ...original, duration: splitMs - original.start };
    const rightBase: Clip = {
      ...original,
      id: newId(),
      start: splitMs,
      duration: end - splitMs,
    };
    const right: Clip =
      hasSourceTrim(rightBase) && hasSourceTrim(original)
        ? { ...rightBase, trimIn: original.trimIn + (splitMs - original.start) }
        : rightBase;

    const nextClips = [...track.clips];
    nextClips.splice(idx, 1, left, right);
    return { ...track, clips: nextClips };
  });

  if (!touched) return project;
  return syncRootTimeline({
    ...project,
    updatedAt: Date.now(),
    timeline: { ...project.timeline, tracks },
  });
};
