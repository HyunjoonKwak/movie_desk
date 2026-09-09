import { type Clip, clipEnd, hasSourceTrim, type SequenceClip } from "../model/clip";
import type { Project, Timeline } from "../model/project";
import { replaceTimeline } from "../model/project-timelines";
import type { Track } from "../model/track";
import { type ID, newId } from "../utils/id";
import type { Ms } from "../utils/time";
import { MAX_SEQUENCE_DEPTH, analyzeSequenceGraph, sequenceEditReason } from "./sequence-graph";
import { hasSpeedRamp } from "./speed";

/** Why an edit was refused, so the caller can explain it rather than no-op silently. */
export type CompoundRefusal =
  | "needs-selection"
  | "not-a-sequence"
  | "depth-exceeded"
  | "cyclic-sequence"
  | "missing-sequence"
  | "speed-ramped";

export interface CompoundResult {
  readonly project: Project;
  readonly refusal?: CompoundRefusal;
  /** Set when unpacking discards content the parent clip had trimmed away. */
  readonly trimmedAway?: number;
}

const refuse = (project: Project, refusal: CompoundRefusal): CompoundResult => ({
  project,
  refusal,
});

const selectedIn = (timeline: Timeline, ids: ReadonlySet<ID>) =>
  timeline.tracks.flatMap((track) => track.clips.filter((clip) => ids.has(clip.id)));

/**
 * Move the selected clips into a new timeline and leave one sequence clip in
 * their place. Gaps between the selection are preserved: the compound keeps the
 * shape the user could see, rather than silently closing holes.
 */
export const createCompound = (
  project: Project,
  clipIds: readonly ID[],
  label?: string,
): CompoundResult => {
  const ids = new Set(clipIds);
  const timeline = project.timeline;
  const picked = selectedIn(timeline, ids);
  if (!picked.length) return refuse(project, "needs-selection");

  const start = picked.reduce((min, clip) => Math.min(min, clip.start), Number.POSITIVE_INFINITY);
  const end = picked.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
  const duration = Math.max(1, end - start);

  // Wrapping adds one level above the deepest selected sequence, so a selection
  // that is already at the cap cannot be nested again.
  const graph = analyzeSequenceGraph(project);
  const deepest = picked.reduce(
    (max, clip) => (clip.kind === "sequence" ? Math.max(max, graph.depths.get(clip.timelineId) ?? 1) : max),
    0,
  );
  if (deepest + 2 > MAX_SEQUENCE_DEPTH) return refuse(project, "depth-exceeded");

  // Only the tracks that actually hold a selected clip become child tracks, so
  // the compound does not inherit empty tracks the user never filled.
  const sourceTracks = timeline.tracks.filter((track) => track.clips.some((clip) => ids.has(clip.id)));
  const childTracks: Track[] = sourceTracks.map((track) => ({
    ...track,
    id: newId(),
    clips: track.clips.filter((clip) => ids.has(clip.id)).map((clip) => ({ ...clip, start: clip.start - start })),
  }));

  const childId = newId();
  const child: Timeline = {
    ...timeline,
    id: childId,
    tracks: childTracks,
    duration,
    playhead: 0,
    markers: [],
  };

  // The sequence clip lands on the track of the earliest selected clip, which is
  // where the user's eye already is.
  const anchor = picked.reduce((first, clip) => (clip.start < first.start ? clip : first), picked[0]!);
  const anchorTrackId = timeline.tracks.find((track) => track.clips.some((clip) => clip.id === anchor.id))!.id;
  const sequence: SequenceClip = {
    id: newId(),
    kind: "sequence",
    timelineId: childId,
    start,
    duration,
    trimIn: 0,
    trimOut: duration,
    speed: 1,
    effects: [],
    keyframes: [],
    // Timeline carries no name, so the compound is identified by the clip the
    // user actually sees. Callers pass a localized default.
    ...(label ? { label } : {}),
  };

  const parent: Timeline = {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: [
        ...track.clips.filter((clip) => !ids.has(clip.id)),
        ...(track.id === anchorTrackId ? [sequence] : []),
      ].sort((a, b) => a.start - b.start),
    })),
  };

  const next = replaceTimeline({ ...project, timelines: [...project.timelines, child] }, parent);
  const reason = sequenceEditReason(next, [sequence], parent.id);
  if (reason) return refuse(project, reason);
  return { project: next };
};

/**
 * Replace a sequence clip with the child clips it was showing. The result must
 * render the same frames it did before, so anything the parent had trimmed away
 * is dropped and reported rather than silently reappearing.
 */
export const unpackCompound = (project: Project, clipId: ID): CompoundResult => {
  const timeline = project.timeline;
  const host = timeline.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
  const target = host?.clips.find((clip) => clip.id === clipId);
  if (!target || target.kind !== "sequence") return refuse(project, "not-a-sequence");
  // A ramp maps timeline time to source time non-linearly; per-clip speed cannot
  // express that, so unpacking would change what plays.
  if (hasSpeedRamp(target)) return refuse(project, "speed-ramped");

  const child = project.timelines.find((item) => item.id === target.timelineId);
  if (!child) return refuse(project, "missing-sequence");

  const rate = target.speed || 1;
  const windowStart = target.trimIn;
  const windowEnd = target.trimIn + target.duration * rate;
  const toParent = (childMs: Ms): Ms => target.start + (childMs - windowStart) / rate;

  let trimmedAway = 0;
  const lifted = child.tracks.map((track) => ({
    track,
    clips: track.clips.flatMap((clip): Clip[] => {
      const from = Math.max(clip.start, windowStart);
      const to = Math.min(clipEnd(clip), windowEnd);
      if (to <= from) {
        trimmedAway += 1;
        return [];
      }
      if (from > clip.start || to < clipEnd(clip)) trimmedAway += 1;
      const headMs = from - clip.start;
      const next = {
        ...clip,
        start: toParent(from),
        duration: Math.max(1, (to - from) / rate),
        speed: clip.speed * rate,
      };
      // Trimming the head of a source-backed clip must advance into the source
      // by the same amount, or the visible frame changes.
      return [
        hasSourceTrim(next) && headMs > 0
          ? { ...next, trimIn: next.trimIn + headMs * clip.speed }
          : next,
      ];
    }),
  }));

  const tracks = [...timeline.tracks];
  const placeInto = (index: number): Track => {
    const existing = tracks[index];
    if (existing) return existing;
    const template = tracks[tracks.length - 1]!;
    const created: Track = { ...template, id: newId(), clips: [] };
    tracks.push(created);
    return created;
  };
  const hostIndex = tracks.findIndex((track) => track.id === host!.id);
  lifted.forEach((entry, offset) => {
    const index = hostIndex + offset;
    const into = placeInto(index);
    const at = tracks.findIndex((track) => track.id === into.id);
    tracks[at] = {
      ...into,
      clips: [...into.clips.filter((clip) => clip.id !== clipId), ...entry.clips].sort(
        (a, b) => a.start - b.start,
      ),
    };
  });

  const parent: Timeline = { ...timeline, tracks };
  // Another clip may still show this child; only drop a timeline nothing uses.
  // Scan the edited parent, never the stale copy that still holds the clip.
  const stillUsed = project.timelines
    .map((item) => (item.id === parent.id ? parent : item))
    .some(
    (item) =>
      item.id !== child.id &&
      item.tracks.some((track) =>
        track.clips.some((clip) => clip.kind === "sequence" && clip.timelineId === child.id),
      ),
  );
  const timelines = stillUsed
    ? project.timelines
    : project.timelines.filter((item) => item.id !== child.id);
  return {
    project: replaceTimeline({ ...project, timelines }, parent),
    ...(trimmedAway ? { trimmedAway } : {}),
  };
};
