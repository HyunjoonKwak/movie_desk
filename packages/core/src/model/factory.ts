import { newId } from "../utils/id";
import type { Project } from "./project";
import { hydrateProjectTimelines, syncRootTimeline } from "./project-timelines";
import type { Track } from "./track";

// The two tracks every new timeline starts with.
export const createDefaultTracks = (): Track[] => {
  const videoTrack: Track = {
    id: newId(),
    kind: "video",
    name: "V1",
    height: 60,
    muted: false,
    solo: false,
    locked: false,
    clips: [],
  };
  const audioTrack: Track = {
    id: newId(),
    kind: "audio",
    name: "A1",
    height: 48,
    muted: false,
    solo: false,
    locked: false,
    clips: [],
  };
  return [videoTrack, audioTrack];
};

export const createEmptyProject = (overrides?: Partial<Project>): Project => {
  const now = Date.now();
  const base = hydrateProjectTimelines({
    id: overrides?.id ?? newId(),
    name: "Untitled",
    createdAt: now,
    updatedAt: now,
    framerate: 30,
    resolution: { w: 1920, h: 1080 },
    timeline: {
      tracks: createDefaultTracks(),
      playhead: 0,
      zoom: 0.05, // 50 px per second by default
      duration: 0,
    },
    mediaLibrary: [],
  });
  if (overrides?.timelines) {
    if (
      new Set(overrides.timelines.map((timeline) => timeline.id)).size !==
      overrides.timelines.length
    )
      throw new Error("Duplicate timeline ID in project overrides");
    const rootTimelineId = overrides.rootTimelineId ?? overrides.timelines[0]?.id;
    const timeline =
      overrides.timeline?.id === rootTimelineId
        ? overrides.timeline
        : overrides.timelines.find((candidate) => candidate.id === rootTimelineId);
    if (!timeline) throw new Error("Missing root timeline in project overrides");
    return syncRootTimeline({ ...base, ...overrides, rootTimelineId: timeline.id, timeline });
  }
  const timeline = overrides?.timeline ?? base.timeline;
  if (overrides?.rootTimelineId && overrides.rootTimelineId !== timeline.id)
    throw new Error("Root timeline override does not match timeline");
  return { ...base, ...overrides, timeline, timelines: [timeline], rootTimelineId: timeline.id };
};
