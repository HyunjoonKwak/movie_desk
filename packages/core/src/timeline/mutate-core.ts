import { sequenceEditReason } from "./sequence-graph";
import { syncRootTimeline } from "../model/project-timelines";
// Track and clip primitives: add/remove/update + linear move/trim + cross-
// track move. All pure — they take a project and return a fresh one.

import type { Project } from "../model/project";
import type { Track } from "../model/track";
import type { Clip } from "../model/clip";
import { clipEnd } from "../model/clip";
import type { ID } from "../utils/id";
import { newId } from "../utils/id";
import type { Ms } from "../utils/time";
import { snapMsToFrame } from "../utils/time";
import { recompute, replaceTrack } from "./mutate-internal";

export const addTrack = (project: Project, track: Omit<Track, "id" | "clips">): Project => {
  const t: Track = { id: newId(), clips: [], ...track };
  return recompute({
    ...project,
    timeline: { ...project.timeline, tracks: [...project.timeline.tracks, t] },
  });
};

// Insert a track at a specific array position. Earlier tracks composite on
// top, so `index` chooses the layer, not just the panel row.
export const addTrackAt = (
  project: Project,
  track: Omit<Track, "id" | "clips">,
  index: number,
): Project => {
  const t: Track = { id: newId(), clips: [], ...track };
  const at = Math.max(0, Math.min(index, project.timeline.tracks.length));
  return recompute({
    ...project,
    timeline: { ...project.timeline, tracks: project.timeline.tracks.toSpliced(at, 0, t) },
  });
};

export const removeTrack = (project: Project, trackId: ID): Project =>
  recompute({
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.filter((t) => t.id !== trackId),
    },
  });

export const updateTrack = (project: Project, trackId: ID, patch: (t: Track) => Track): Project => {
  let touched = false;
  const tracks = project.timeline.tracks.map((t) => {
    if (t.id !== trackId) return t;
    touched = true;
    return patch(t);
  });
  if (!touched) return project;
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

export const addClip = (project: Project, trackId: ID, clip: Clip): Project => {
  const track = project.timeline.tracks.find((t) => t.id === trackId);
  if (!track || sequenceEditReason(project, [clip])) return project;
  const snapped: Clip = {
    ...clip,
    start: snapMsToFrame(clip.start, project.framerate),
    duration: snapMsToFrame(clip.duration, project.framerate),
  };
  const updatedTrack: Track = {
    ...track,
    clips: [...track.clips, snapped].toSorted((a, b) => a.start - b.start),
  };
  return recompute(replaceTrack(project, updatedTrack));
};

export const removeClip = (project: Project, clipId: ID): Project => {
  let touched = false;
  const tracks = project.timeline.tracks.map((t) => {
    const next = t.clips.filter((c) => c.id !== clipId);
    if (next.length !== t.clips.length) touched = true;
    return next === t.clips ? t : { ...t, clips: next };
  });
  if (!touched) return project;
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

export const updateClip = (project: Project, clipId: ID, patch: (c: Clip) => Clip): Project => {
  let touched = false;
  const tracks = project.timeline.tracks.map((t) => {
    const next = t.clips.map((c) => {
      if (c.id !== clipId) return c;
      touched = true;
      return patch(c);
    });
    return touched ? { ...t, clips: next.toSorted((a, b) => a.start - b.start) } : t;
  });
  if (!touched) return project;
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

export const moveClip = (project: Project, clipId: ID, deltaMs: Ms): Project =>
  updateClip(project, clipId, (c) => ({
    ...c,
    start: Math.max(0, snapMsToFrame(c.start + deltaMs, project.framerate)),
  }));

export const trimClipStart = (project: Project, clipId: ID, newStart: Ms): Project =>
  updateClip(project, clipId, (c) => {
    const end = clipEnd(c);
    const start = Math.min(newStart, end - 1);
    return { ...c, start: Math.max(0, start), duration: Math.max(1, end - start) };
  });

export const trimClipEnd = (project: Project, clipId: ID, newEnd: Ms): Project =>
  updateClip(project, clipId, (c) => ({ ...c, duration: Math.max(1, newEnd - c.start) }));

// Transient view state — no recompute, no history bookkeeping by the caller.
export const setPlayhead = (project: Project, playhead: Ms): Project =>
  syncRootTimeline({
    ...project,
    timeline: { ...project.timeline, playhead: Math.max(0, playhead) },
  });

export const setZoom = (project: Project, zoom: number): Project =>
  syncRootTimeline({
    ...project,
    timeline: { ...project.timeline, zoom: Math.max(0.001, zoom) },
  });

// Move a clip to a different track. Removes it from the source track and adds
// it on the destination, frame-snapping in the process. No-op when the clip
// is already on the destination or either id is unknown.
export const moveClipToTrack = (project: Project, clipId: ID, destTrackId: ID): Project => {
  const clip = project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clip || !project.timeline.tracks.some((t) => t.id === destTrackId) || sequenceEditReason(project, [clip])) return project;
  let moving: Clip | null = null;
  const stripped = project.timeline.tracks.map((t) => {
    const found = t.clips.find((c) => c.id === clipId);
    if (!found) return t;
    if (t.id === destTrackId) return t; // already on dest — addClip below would re-snap
    moving = found;
    return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
  });
  if (!moving) return project;
  const projectAfterStrip: Project = syncRootTimeline({
    ...project,
    timeline: { ...project.timeline, tracks: stripped },
  });
  return addClip(projectAfterStrip, destTrackId, moving);
};
