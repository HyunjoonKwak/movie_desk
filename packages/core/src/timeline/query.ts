import type { Project, Timeline } from "../model/project";
import type { Track } from "../model/track";
import type { Clip } from "../model/clip";
import { clipEnd } from "../model/clip";
import type { ID } from "../utils/id";
import type { Ms } from "../utils/time";

export const allClips = (timeline: Timeline): readonly Clip[] =>
  timeline.tracks.flatMap((t) => t.clips);

export const findTrack = (timeline: Timeline, trackId: ID): Track | undefined =>
  timeline.tracks.find((t) => t.id === trackId);

export const findClip = (timeline: Timeline, clipId: ID): Clip | undefined =>
  allClips(timeline).find((c) => c.id === clipId);

export const computeDuration = (timeline: Timeline): Ms =>
  allClips(timeline).reduce((max, c) => Math.max(max, clipEnd(c)), 0);

export const clipsAt = (timeline: Timeline, t: Ms): readonly Clip[] => {
  // When any track is soloed, only soloed tracks contribute to the frame.
  const soloing = timeline.tracks.some((tr) => tr.solo);
  const out: Clip[] = [];
  for (const tr of timeline.tracks) {
    if (soloing && !tr.solo) continue;
    for (const c of tr.clips) {
      if (!c.disabled && t >= c.start && t < clipEnd(c)) out.push(c);
    }
  }
  return out;
};

export const visibleAt = (project: Project, t: Ms): readonly Clip[] => clipsAt(project.timeline, t);

export const findTimeline = (project: Project, id: ID): Timeline | undefined =>
  project.timelines.find((timeline) => timeline.id === id);
