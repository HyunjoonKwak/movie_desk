import type { Clip } from "../model/clip";
import { createDefaultTracks } from "../model/factory";
import type { Project, Timeline } from "../model/project";
import type { Track } from "../model/track";
import { type ID, newId } from "../utils/id";
import { collectSequenceRefs } from "./sequence-graph";

// A project holds one media library and any number of cuts: top-level
// timelines the editor can switch between. Switching moves the root alias,
// so the viewer, transport, audio and export follow without knowing.

export interface CutResult {
  readonly project: Project;
  readonly cutId: ID;
}

export const isCut = (project: Project, timelineId: ID): boolean => {
  if (timelineId === project.rootTimelineId) return true;
  return project.timelines.find((t) => t.id === timelineId)?.role === "cut";
};

export const listCuts = (project: Project): readonly Timeline[] =>
  project.timelines.filter((t) => isCut(project, t.id));

const cleanName = (name: string | undefined): string | undefined => {
  const trimmed = name?.trim().slice(0, 80);
  return trimmed ? trimmed : undefined;
};

const withName = (timeline: Timeline, name: string | undefined): Timeline => {
  const { name: _dropped, ...rest } = timeline;
  return name === undefined ? rest : { ...rest, name };
};

export const switchCut = (project: Project, cutId: ID): Project => {
  if (cutId === project.rootTimelineId) return project;
  const next = project.timelines.find((t) => t.id === cutId);
  if (!next) throw new Error(`Unknown cut: ${cutId}`);
  if (!isCut(project, cutId)) throw new Error(`Not a cut: ${cutId}`);
  // The outgoing root stays a cut once it is no longer the root.
  const timelines = project.timelines.map((t) =>
    t.id === project.rootTimelineId && t.role !== "cut" ? { ...t, role: "cut" as const } : t,
  );
  const root = timelines.find((t) => t.id === cutId) ?? next;
  return { ...project, timelines, rootTimelineId: cutId, timeline: root };
};

const addCut = (project: Project, timeline: Timeline): CutResult => {
  const cut: Timeline = { ...timeline, role: "cut" };
  return {
    project: switchCut({ ...project, timelines: [...project.timelines, cut] }, cut.id),
    cutId: cut.id,
  };
};

export const createCut = (project: Project, name?: string): CutResult =>
  addCut(
    project,
    withName(
      {
        id: newId(),
        tracks: createDefaultTracks(),
        playhead: 0,
        zoom: project.timeline.zoom,
        duration: 0,
      },
      cleanName(name),
    ),
  );

export const renameCut = (project: Project, cutId: ID, name: string): Project => {
  const timeline = project.timelines.find((t) => t.id === cutId);
  if (!timeline || !isCut(project, cutId)) throw new Error(`Unknown cut: ${cutId}`);
  const renamed = withName(timeline, cleanName(name));
  if (renamed.name === timeline.name) return project;
  const timelines = project.timelines.map((t) => (t.id === cutId ? renamed : t));
  return {
    ...project,
    timelines,
    timeline: cutId === project.rootTimelineId ? renamed : project.timeline,
  };
};

const copyClip = (clip: Clip): Clip => ({ ...clip, id: newId() });
const copyTrack = (track: Track): Track => ({
  ...track,
  id: newId(),
  clips: track.clips.map(copyClip),
});

// Clips and tracks get fresh ids so the copy is independent; a sequence clip
// keeps pointing at the same compound child, which both cuts then share.
export const duplicateCut = (project: Project, cutId: ID, name?: string): CutResult => {
  const source = project.timelines.find((t) => t.id === cutId);
  if (!source || !isCut(project, cutId)) throw new Error(`Unknown cut: ${cutId}`);
  const groupIds = new Map<ID, ID>();
  const tracks = source.tracks.map(copyTrack).map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      if (!clip.groupId) return clip;
      const groupId = groupIds.get(clip.groupId) ?? newId();
      groupIds.set(clip.groupId, groupId);
      return { ...clip, groupId };
    }),
  }));
  return addCut(
    project,
    withName(
      { ...source, id: newId(), tracks, playhead: 0 },
      cleanName(name) ?? (source.name ? `${source.name} 2` : undefined),
    ),
  );
};

// Compound children that only this cut used go with it; anything another
// timeline still references stays.
export const deleteCut = (project: Project, cutId: ID): Project => {
  const cuts = listCuts(project);
  if (!cuts.some((c) => c.id === cutId)) throw new Error(`Unknown cut: ${cutId}`);
  if (cuts.length < 2) throw new Error("A project keeps at least one cut");
  const survivor = cuts.find((c) => c.id !== cutId)!;
  const moved = switchCut(project, survivor.id);
  const remaining = moved.timelines.filter((t) => t.id !== cutId);
  const referenced = new Set(remaining.flatMap((t) => collectSequenceRefs(t)));
  const timelines = remaining.filter(
    (t) => isCut(moved, t.id) || referenced.has(t.id) || t.id === moved.rootTimelineId,
  );
  return { ...moved, timelines };
};
