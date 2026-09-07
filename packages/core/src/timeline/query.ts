import { analyzeSequenceGraph, MAX_SEQUENCE_DEPTH } from "./sequence-graph";
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

// Edit/load query, never a frame-loop operation. Postorder memoization visits
// each timeline once; unsafe subtrees contribute zero (black/silent duration).
export const computeDuration = (project: Project, timelineId = project.rootTimelineId): Ms => {
  const timeline =
    timelineId === project.rootTimelineId ? project.timeline : findTimeline(project, timelineId);
  if (!timeline) return 0;
  // Dragging ordinary clips must not scan unrelated timelines or construct a
  // sequence graph. Detect sequence sources during the original duration pass.
  let flatDuration = 0;
  let hasSequence = false;
  for (const track of timeline.tracks)
    for (const clip of track.clips) {
      if (clip.kind === "sequence") hasSequence = true;
      flatDuration = Math.max(flatDuration, clipEnd(clip));
    }
  if (!hasSequence) return flatDuration;
  const graph = analyzeSequenceGraph(project);
  const durations = new Map<ID, Ms>();
  for (const id of graph.order) {
    if ((graph.depths.get(id) ?? 0) > MAX_SEQUENCE_DEPTH) {
      durations.set(id, 0);
      continue;
    }
    let duration = 0;
    for (const clip of allClips(graph.timelines.get(id)!)) {
      const span =
        clip.kind === "sequence"
          ? Math.max(0, Math.min(clip.trimOut, durations.get(clip.timelineId) ?? 0) - clip.trimIn) /
            Math.max(0.001, clip.speed)
          : clip.duration;
      if (span > 0) duration = Math.max(duration, clip.start + span);
    }
    durations.set(id, duration);
  }
  return durations.get(timelineId) ?? 0;
};

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
