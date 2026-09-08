import { syncRootTimeline, createTimelineView, restoreTimelineView, type Project } from "@movie-desk/core";
import { useTimelineUiStore } from "./timeline-ui-store";

export const timelineView = createTimelineView;

export const activeTimelineView = (project: Project): Project =>
  timelineView(project, useTimelineUiStore.getState().activeTimelineId);

/** Run existing single-timeline primitives, then restore the canonical root alias. */
export const editActiveTimeline = (project: Project, edit: (view: Project) => Project): Project => {
  const view = activeTimelineView(project);
  const after = edit(view);
  if (after === view) return project;
  const synced = syncRootTimeline(after);
  if (view === project) return synced;
  return restoreTimelineView(synced, project.rootTimelineId);
};
