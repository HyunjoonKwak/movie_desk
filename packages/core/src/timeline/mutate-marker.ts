import { syncRootTimeline } from "../model/project-timelines";
// Timeline markers: add / remove / update. Stored on the timeline rather
// than on a track so they're independent of clip layout.

import type { Project } from "../model/project";
import type { Marker } from "../model/marker";
import type { ID } from "../utils/id";
import { newId } from "../utils/id";

const withMarkers = (project: Project, markers: readonly Marker[]): Project =>
  syncRootTimeline({
    ...project,
    updatedAt: Date.now(),
    timeline: { ...project.timeline, markers },
  });

export const addMarker = (project: Project, marker: Omit<Marker, "id">): Project => {
  const m: Marker = { id: newId(), ...marker };
  const next = [...(project.timeline.markers ?? []), m].sort((a, b) => a.at - b.at);
  return withMarkers(project, next);
};

export const removeMarker = (project: Project, markerId: ID): Project => {
  const cur = project.timeline.markers ?? [];
  const next = cur.filter((m) => m.id !== markerId);
  if (next.length === cur.length) return project;
  return withMarkers(project, next);
};

export const updateMarker = (
  project: Project,
  markerId: ID,
  patch: Partial<Omit<Marker, "id">>,
): Project => {
  const cur = project.timeline.markers ?? [];
  let touched = false;
  const next = cur
    .map((m) => {
      if (m.id !== markerId) return m;
      touched = true;
      return { ...m, ...patch };
    })
    .sort((a, b) => a.at - b.at);
  if (!touched) return project;
  return withMarkers(project, next);
};
