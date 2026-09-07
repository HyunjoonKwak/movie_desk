import { type SequenceClip, createEmptyProject, newId, replaceTimeline } from "@movie-desk/core";

// Deliberately reuse track and clip IDs across timelines: only timeline-scoped
// persistence keys can round-trip these two independently editable entities.
export const nestedProject = () => {
  const base = createEmptyProject();
  const childId = newId();
  const sequence: SequenceClip = {
    id: newId(),
    kind: "sequence",
    timelineId: childId,
    start: 0,
    duration: 1000,
    speed: 1,
    trimIn: 25,
    trimOut: 1025,
    volume: 0.4,
    effects: [],
    keyframes: [],
  };
  const root = {
    ...base.timeline,
    duration: 1000,
    tracks: base.timeline.tracks.map((track, i) =>
      i === 0 ? { ...track, clips: [sequence] } : track,
    ),
  };
  const child = {
    ...base.timeline,
    id: childId,
    duration: 1000,
    markers: [{ id: newId(), at: 250, label: "Child cue", color: "#ff0000" }],
    tracks: base.timeline.tracks.map((track, i) =>
      i === 0
        ? {
            ...track,
            name: "Child track",
            clips: [
              {
                ...sequence,
                kind: "adjustment" as const,
                label: "Child only",
              },
            ],
          }
        : track,
    ),
  };
  return replaceTimeline({ ...base, timelines: [base.timeline, child] }, root);
};
