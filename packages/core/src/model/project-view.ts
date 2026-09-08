import type { ID } from "../utils/id";
import type { Project } from "./project";

// Enumerable symbols survive object spreads through legacy edit primitives,
// but are never wire fields. The enumerable toJSON trap also survives spreads
// and rejects accidental JSON serialization before the symbol can be dropped.
const EDITOR_VIEW = Symbol("editor timeline view");
const rejectSerialization = (): never => {
  throw new Error("An editor timeline view cannot enter persistence or history");
};

export const assertCanonicalProject = (project: unknown): void => {
  if (typeof project === "object" && project !== null && EDITOR_VIEW in project)
    rejectSerialization();
};

export const createTimelineView = (project: Project, timelineId: ID | null): Project => {
  assertCanonicalProject(project);
  const timeline = project.timelines.find((item) => item.id === timelineId) ?? project.timeline;
  if (timeline === project.timeline) return project;
  return Object.assign({ ...project, timeline, rootTimelineId: timeline.id }, {
    [EDITOR_VIEW]: project.rootTimelineId,
    toJSON: rejectSerialization,
  });
};

/** The sole materialization boundary: restore the original root before unmarking. */
export const restoreTimelineView = (project: Project, rootTimelineId: ID): Project => {
  const marked = project as Project & { [EDITOR_VIEW]?: ID; toJSON?: () => never };
  if (marked[EDITOR_VIEW] !== rootTimelineId)
    throw new Error("Editor timeline view lost its canonical root provenance");
  const root = project.timelines.find((item) => item.id === rootTimelineId);
  if (!root) throw new Error("An editor action removed the root timeline");
  const { [EDITOR_VIEW]: _view, toJSON: _serialize, ...rest } = marked;
  return { ...rest, rootTimelineId, timeline: root };
};
