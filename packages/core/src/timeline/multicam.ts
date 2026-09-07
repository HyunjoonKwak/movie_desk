import { syncRootTimeline } from "../model/project-timelines";
import { addClip, addTrack, removeClip } from "./mutate";
import { splitClipAt } from "./split";
import { isMediaClip, type MediaClip } from "../model/clip";
import type { Project } from "../model/project";
import type { ID } from "../utils/id";
import { newId } from "../utils/id";
import type { Ms } from "../utils/time";

// Multicam: a set of synchronized source clips (angles). The editor builds a
// single "program" track; switching the active angle at a given time splits
// the program clip and swaps the underlying asset for that segment.

export interface MulticamAngle {
  readonly assetId: ID;
  readonly offsetMs: Ms; // sync offset relative to the program start
  readonly label: string;
}

// Create a program track seeded from the first angle, spanning `durationMs`.
// Returns the new project plus the id of the created program clip.
export const createMulticamProgram = (
  project: Project,
  angles: readonly MulticamAngle[],
  durationMs: Ms,
): { project: Project; programClipId: ID | null } => {
  if (angles.length === 0) return { project, programClipId: null };
  const first = angles[0]!;

  let next = addTrack(project, {
    kind: "video",
    name: "Multicam",
    height: 60,
    muted: false,
    solo: false,
    locked: false,
  });
  const track = next.timeline.tracks.at(-1)!;
  const programClipId = newId();
  next = addClip(next, track.id, {
    kind: "media",
    id: programClipId,
    assetId: first.assetId,
    start: 0,
    duration: durationMs,
    trimIn: first.offsetMs,
    trimOut: first.offsetMs + durationMs,
    speed: 1,
    effects: [],
    keyframes: [],
  });
  return { project: next, programClipId };
};

// Switch the active angle at `atMs`: split the covering program clip and
// repoint the right-hand slice to the chosen angle's asset (respecting sync
// offset). The program track is identified by name "Multicam".
export const switchAngleAt = (project: Project, atMs: Ms, angle: MulticamAngle): Project => {
  const track = project.timeline.tracks.find((t) => t.name === "Multicam");
  if (!track) return project;
  const covering = track.clips.find(
    (c) => atMs > c.start && atMs < c.start + c.duration && isMediaClip(c),
  ) as MediaClip | undefined;
  if (!covering) return project;

  let next = splitClipAt(project, covering.id, atMs);
  // After the split, find the right-hand slice (starts at atMs) on the track.
  const updatedTrack = next.timeline.tracks.find((t) => t.name === "Multicam");
  const right = updatedTrack?.clips.find((c) => Math.abs(c.start - atMs) < 1 && isMediaClip(c)) as
    | MediaClip
    | undefined;
  if (!right) return next;

  // Repoint that slice to the new angle: same timeline position, new asset,
  // trimIn shifted by the angle's sync offset.
  const relInProgram = right.start; // program starts at 0
  next = repointClip(next, right.id, angle.assetId, angle.offsetMs + relInProgram, right.duration);
  return next;
};

const repointClip = (
  project: Project,
  clipId: ID,
  assetId: ID,
  trimIn: Ms,
  duration: Ms,
): Project => {
  const tracks = project.timeline.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) =>
      c.id === clipId && isMediaClip(c) ? { ...c, assetId, trimIn, trimOut: trimIn + duration } : c,
    ),
  }));
  return syncRootTimeline({
    ...project,
    updatedAt: Date.now(),
    timeline: { ...project.timeline, tracks },
  });
};

// Remove the entire multicam program track.
export const removeMulticamProgram = (project: Project): Project => {
  const track = project.timeline.tracks.find((t) => t.name === "Multicam");
  if (!track) return project;
  let next = project;
  for (const c of track.clips) next = removeClip(next, c.id);
  return syncRootTimeline({
    ...next,
    timeline: {
      ...next.timeline,
      tracks: next.timeline.tracks.filter((t) => t.name !== "Multicam"),
    },
  });
};
