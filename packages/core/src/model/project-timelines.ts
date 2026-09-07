import type { ID } from "../utils/id";
import type { Project, Timeline } from "./project";

/** Single-timeline v1 wire shape. Timeline identity is session-derived in Phase 0. */
export type LegacyProject = Omit<Project, "timelines" | "rootTimelineId" | "timeline"> & {
  readonly timeline: Omit<Timeline, "id"> & { readonly id?: ID };
};

/** Stable across JSON/CRDT reloads without adding a persisted ID field. */
export const rootTimelineIdForProject = (projectId: ID): ID => `${projectId}:root` as ID;

/** Load only the v1 shape. Never silently discard future nested persistence data. */
export const hydrateProjectTimelines = (input: LegacyProject): Project => {
  if ("timelines" in input || "rootTimelineId" in input)
    throw new Error("Nested timeline persistence is not supported yet");
  const timeline: Timeline = {
    ...input.timeline,
    id: input.timeline.id ?? rootTimelineIdForProject(input.id),
  };
  return { ...input, timeline, timelines: [timeline], rootTimelineId: timeline.id };
};

/** Replace one timeline and derive the legacy root alias from the collection. */
export const replaceTimeline = (project: Project, timeline: Timeline): Project => {
  if (!project.timelines.some((candidate) => candidate.id === timeline.id))
    throw new Error(`Unknown timeline: ${timeline.id}`);
  const timelines = project.timelines.map((candidate) =>
    candidate.id === timeline.id ? timeline : candidate,
  );
  const root = timelines.find((candidate) => candidate.id === project.rootTimelineId);
  if (!root) throw new Error(`Missing root timeline: ${project.rootTimelineId}`);
  return { ...project, timelines, timeline: root };
};

/** Compatibility write boundary for callers still spreading the root alias. */
export const syncRootTimeline = (project: Project): Project => {
  if (project.timeline.id !== project.rootTimelineId)
    throw new Error("Root timeline alias does not match rootTimelineId");
  if (
    project.timelines.find((candidate) => candidate.id === project.rootTimelineId) ===
    project.timeline
  )
    return project;
  return replaceTimeline(project, project.timeline);
};

/** Keep v1 writes lossless; Phase 1 + 7 will replace this boundary atomically. */
export const toLegacyProject = (project: Project): LegacyProject => {
  if (
    project.timelines.length !== 1 ||
    project.timelines[0] !== project.timeline ||
    project.timeline.id !== project.rootTimelineId
  )
    throw new Error("Cannot persist nested or inconsistent timelines in v1");
  const { timelines: _timelines, rootTimelineId: _root, timeline, ...rest } = project;
  const { id: _id, ...legacyTimeline } = timeline;
  return { ...rest, timeline: legacyTimeline };
};
