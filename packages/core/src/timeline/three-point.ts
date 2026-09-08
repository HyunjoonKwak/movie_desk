import { type Clip, clipEnd, hasSourceTrim } from "../model/clip";
import type { Project } from "../model/project";
import type { ID } from "../utils/id";
import { newId } from "../utils/id";
import type { Ms } from "../utils/time";
import { snapMsToFrame } from "../utils/time";
import { recompute, replaceTrack } from "./mutate-internal";
import { findTrack } from "./query";
import { splitClipAt } from "./split";

// FCP-style three-point edits: W (insert with ripple) and D (overwrite).
// Both place `clip` at the frame-snapped `atMs` on `trackId` with a
// frame-snapped duration; the incoming clip's own `start` is ignored.

// Insert (W): split any clip straddling the point on the target track,
// shift everything at or after it right by the incoming duration on EVERY
// unlocked track (parallel audio/titles stay in sync, matching ripple
// delete), and drop the clip into the opened gap.
export const insertClipAt = (project: Project, trackId: ID, clip: Clip, atMs: Ms): Project => {
  const track = findTrack(project.timeline, trackId);
  if (!track) return project;
  const at = Math.max(0, snapMsToFrame(atMs, project.framerate));
  const dur = Math.max(1, snapMsToFrame(clip.duration, project.framerate));
  const straddler = track.clips.find((c) => c.start < at && clipEnd(c) > at);
  const split = straddler ? splitClipAt(project, straddler.id, at) : project;
  const tracks = split.timeline.tracks.map((t) => {
    if (t.locked && t.id !== trackId) return t;
    const shifted = t.clips.map((c) => (c.start >= at ? { ...c, start: c.start + dur } : c));
    if (t.id !== trackId) return { ...t, clips: shifted };
    const clips = [...shifted, { ...clip, start: at, duration: dur }].sort(
      (a, b) => a.start - b.start,
    );
    return { ...t, clips };
  });
  return recompute({ ...split, timeline: { ...split.timeline, tracks } });
};

// Overwrite (D): clear the window [at, at + duration) on the track — fully
// covered clips are removed, partially covered ones are trimmed (media
// clips keep their source offset) — then place the clip. Never ripples.
export const overwriteClipAt = (project: Project, trackId: ID, clip: Clip, atMs: Ms): Project => {
  const track = findTrack(project.timeline, trackId);
  if (!track) return project;
  const at = Math.max(0, snapMsToFrame(atMs, project.framerate));
  const dur = Math.max(1, snapMsToFrame(clip.duration, project.framerate));
  const end = at + dur;
  const survivors = track.clips.flatMap((c): Clip[] => {
    const cEnd = clipEnd(c);
    if (cEnd <= at || c.start >= end) return [c];
    const pieces: Clip[] = [];
    if (c.start < at) pieces.push({ ...c, duration: at - c.start });
    if (cEnd > end) {
      const offset = end - c.start;
      // The head survived too → the tail becomes a new clip (split).
      const base: Clip = {
        ...c,
        id: c.start < at ? newId() : c.id,
        start: end,
        duration: cEnd - end,
      };
      pieces.push(
        hasSourceTrim(c) && hasSourceTrim(base) ? { ...base, trimIn: c.trimIn + offset } : base,
      );
    }
    return pieces;
  });
  const clips = [...survivors, { ...clip, start: at, duration: dur }].sort(
    (a, b) => a.start - b.start,
  );
  return recompute(replaceTrack(project, { ...track, clips }));
};
