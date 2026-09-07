import { sequenceEditReason } from "./sequence-graph";
// Higher-level editing ops: ripple/roll/slide/slip trims, gap closing,
// grouping, freeze/disable, audio detach, duplication, crossfade. Each one
// composes the primitives in mutate-core / mutate-effect.

import type { Project } from "../model/project";
import type { Clip } from "../model/clip";
import { clipEnd } from "../model/clip";
import type { ID } from "../utils/id";
import { newId } from "../utils/id";
import type { Ms } from "../utils/time";
import { snapMsToFrame } from "../utils/time";
import { dropKey, recompute } from "./mutate-internal";
import { addClip, addTrack, moveClip, updateClip } from "./mutate-core";
import { setAudioFade } from "./mutate-effect";
import { resolvePlacement } from "./collide";

// Pull every clip starting at/after `from` back by `gap`, clamped so no
// clip overlaps the one before it (left-to-right cursor pass). Clips that
// begin before `from` — including ones straddling it — stay put.
const rippleTrackClips = (clips: readonly Clip[], from: Ms, gap: Ms): readonly Clip[] => {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  let cursor: Ms = 0;
  return sorted.map((c) => {
    if (c.start < from) {
      cursor = Math.max(cursor, clipEnd(c));
      return c;
    }
    const start = Math.max(0, Math.max(c.start - gap, cursor));
    cursor = start + c.duration;
    return start === c.start ? c : { ...c, start };
  });
};

// Ripple delete (FCP magnetic default): remove the clip and pull every
// later clip back by its duration on EVERY unlocked track, so parallel
// audio/titles stay in sync with the video they were cut against.
export const rippleDeleteClip = (project: Project, clipId: ID): Project => {
  let removed: Clip | null = null;
  let trackId: ID | null = null;
  for (const t of project.timeline.tracks) {
    const c = t.clips.find((x) => x.id === clipId);
    if (c) {
      removed = c;
      trackId = t.id;
      break;
    }
  }
  if (!removed || !trackId) return project;
  const gap = removed.duration;
  const from = removed.start;
  const tracks = project.timeline.tracks.map((t) => {
    if (t.locked && t.id !== trackId) return t;
    const remaining = t.id === trackId ? t.clips.filter((c) => c.id !== clipId) : t.clips;
    return { ...t, clips: rippleTrackClips(remaining, from, gap) };
  });
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

// Compact a track so each clip butts against the previous one's end, keeping
// the first clip where it is. Removes all inter-clip gaps in one pass.
export const closeGapsOnTrack = (project: Project, trackId: ID): Project => {
  const tracks = project.timeline.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const sorted = [...t.clips].sort((a, b) => a.start - b.start);
    let cursor = sorted[0]?.start ?? 0;
    const clips = sorted.map((c) => {
      const next = { ...c, start: cursor };
      cursor = cursor + c.duration;
      return next;
    });
    return { ...t, clips };
  });
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

// Assign a fresh group id to the given clips so they move together.
export const groupClips = (project: Project, clipIds: readonly ID[]): Project => {
  if (clipIds.length < 2) return project;
  const ids = new Set(clipIds);
  const groupId = newId();
  const tracks = project.timeline.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) => (ids.has(c.id) ? { ...c, groupId } : c)),
  }));
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

// Remove grouping from every clip that shares the given clip's group.
export const ungroupClips = (project: Project, clipId: ID): Project => {
  const target = project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  const gid = target?.groupId;
  if (!gid) return project;
  const tracks = project.timeline.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) => (c.groupId === gid ? (dropKey(c, "groupId") as typeof c) : c)),
  }));
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

// Move a clip; if it belongs to a group, move all members by the same delta,
// clamped so the earliest member never crosses 0 (keeping the group rigid).
export const moveClipOrGroup = (project: Project, clipId: ID, deltaMs: Ms): Project => {
  const all = project.timeline.tracks.flatMap((t) => t.clips);
  const clip = all.find((c) => c.id === clipId);
  if (!clip || !clip.groupId) return moveClip(project, clipId, deltaMs);
  const members = all.filter((c) => c.groupId === clip.groupId);
  const minStart = members.reduce((m, c) => Math.min(m, c.start), Number.POSITIVE_INFINITY);
  const eff = Math.max(deltaMs, -minStart);
  const ids = new Set(members.map((c) => c.id));
  const tracks = project.timeline.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) =>
      ids.has(c.id)
        ? { ...c, start: Math.max(0, snapMsToFrame(c.start + eff, project.framerate)) }
        : c,
    ),
  }));
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

// Toggle a clip's disabled flag (excluded from render & mix when true).
export const toggleClipDisabled = (project: Project, clipId: ID): Project =>
  updateClip(project, clipId, (c) =>
    c.disabled ? (dropKey(c, "disabled") as typeof c) : { ...c, disabled: true },
  );

// Freeze a media clip on a single source frame, or clear the freeze when
// `freezeMs` is undefined. No-op on non-media clips.
export const setClipFreeze = (project: Project, clipId: ID, freezeMs: Ms | undefined): Project =>
  updateClip(project, clipId, (c) =>
    c.kind !== "media"
      ? c
      : freezeMs !== undefined
        ? { ...c, freeze: freezeMs }
        : (dropKey(c, "freeze") as typeof c),
  );

// Detach a media clip's audio onto a separate audio track and mute the
// original clip's audio (its video stays). Creates an audio track if needed.
export const detachAudio = (project: Project, clipId: ID): Project => {
  let source: Clip | null = null;
  for (const t of project.timeline.tracks) {
    const c = t.clips.find((x) => x.id === clipId);
    if (c) {
      source = c;
      break;
    }
  }
  if (!source || source.kind !== "media") return project;

  let p = project;
  let audioTrack = p.timeline.tracks.find((t) => t.kind === "audio");
  if (!audioTrack) {
    p = addTrack(p, {
      kind: "audio",
      name: "A1",
      height: 48,
      muted: false,
      solo: false,
      locked: false,
    });
    audioTrack = p.timeline.tracks.at(-1)!;
  }
  const audioClip: Clip = {
    kind: "media",
    id: newId(),
    assetId: source.assetId,
    start: source.start,
    duration: source.duration,
    speed: source.speed,
    ...(source.preservePitch === undefined ? {} : { preservePitch: source.preservePitch }),
    trimIn: source.trimIn,
    trimOut: source.trimOut,
    volume: source.volume ?? 1,
    effects: source.effects.filter((effect) => effect.type.startsWith("audio-")),
    keyframes: source.keyframes.filter(
      (track) => track.target === "speed" || track.target === "volume",
    ),
  };
  p = addClip(p, audioTrack.id, audioClip);
  p = updateClip(p, clipId, (c) =>
    c.kind === "media"
      ? {
          ...c,
          volume: 0,
          effects: c.effects.filter((effect) => !effect.type.startsWith("audio-")),
          keyframes: c.keyframes.filter((track) => track.target !== "volume"),
        }
      : c,
  );
  return p;
};

// Roll edit: move the cut between a clip and the next adjacent clip on the
// same track by `deltaMs`. The first clip's end and the second clip's start
// move together (no gap); the second clip's source in-point follows so its
// remaining content stays aligned. No-op without a right-hand neighbour.
export const rollEdit = (project: Project, clipId: ID, deltaMs: Ms): Project => {
  const tracks = project.timeline.tracks.map((t) => {
    const sorted = [...t.clips].sort((a, b) => a.start - b.start);
    const idx = sorted.findIndex((c) => c.id === clipId);
    if (idx < 0 || idx + 1 >= sorted.length) return t;
    const cur = sorted[idx]!;
    const next = sorted[idx + 1]!;
    if (Math.abs(next.start - clipEnd(cur)) > 2) return t;
    let d = deltaMs;
    if (cur.duration + d < 1) d = 1 - cur.duration;
    if (next.duration - d < 1) d = next.duration - 1;
    if (next.kind === "media" && next.trimIn + d < 0) d = -next.trimIn;
    if (d === 0) return t;
    const newCur: Clip = { ...cur, duration: cur.duration + d };
    const newNext: Clip =
      next.kind === "media"
        ? { ...next, start: next.start + d, duration: next.duration - d, trimIn: next.trimIn + d }
        : { ...next, start: next.start + d, duration: next.duration - d };
    const clips = sorted.map((c) => (c.id === cur.id ? newCur : c.id === next.id ? newNext : c));
    return { ...t, clips };
  });
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

// Slide edit: move a clip by `deltaMs` between its neighbours, keeping its own
// source/duration. The previous clip's end extends and the next clip's start
// (and source in-point) shift to absorb the move. Requires both neighbours
// butted to the clip.
export const slideClip = (project: Project, clipId: ID, deltaMs: Ms): Project => {
  const tracks = project.timeline.tracks.map((t) => {
    const sorted = [...t.clips].sort((a, b) => a.start - b.start);
    const idx = sorted.findIndex((c) => c.id === clipId);
    if (idx <= 0 || idx + 1 >= sorted.length) return t;
    const prev = sorted[idx - 1]!;
    const cur = sorted[idx]!;
    const next = sorted[idx + 1]!;
    if (Math.abs(cur.start - clipEnd(prev)) > 2) return t;
    if (Math.abs(next.start - clipEnd(cur)) > 2) return t;
    let d = deltaMs;
    if (prev.duration + d < 1) d = 1 - prev.duration;
    if (next.duration - d < 1) d = next.duration - 1;
    if (next.kind === "media" && next.trimIn + d < 0) d = -next.trimIn;
    if (d === 0) return t;
    const newPrev: Clip = { ...prev, duration: prev.duration + d };
    const newCur: Clip = { ...cur, start: cur.start + d };
    const newNext: Clip =
      next.kind === "media"
        ? { ...next, start: next.start + d, duration: next.duration - d, trimIn: next.trimIn + d }
        : { ...next, start: next.start + d, duration: next.duration - d };
    const clips = sorted.map((c) =>
      c.id === prev.id ? newPrev : c.id === cur.id ? newCur : c.id === next.id ? newNext : c,
    );
    return { ...t, clips };
  });
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

// Slip a media clip: shift its source window (trimIn/trimOut) by `deltaMs`
// while keeping the clip's timeline position and duration fixed. The window
// is clamped to [0, maxSourceMs] so it never runs past the asset bounds.
export const slipClip = (
  project: Project,
  clipId: ID,
  deltaMs: Ms,
  maxSourceMs = Number.POSITIVE_INFINITY,
): Project =>
  updateClip(project, clipId, (c) => {
    if (c.kind !== "media") return c;
    const span = c.trimOut - c.trimIn;
    const maxIn = Number.isFinite(maxSourceMs) ? Math.max(0, maxSourceMs - span) : Number.POSITIVE_INFINITY;
    const inMs = Math.max(0, Math.min(c.trimIn + deltaMs, maxIn));
    return { ...c, trimIn: inMs, trimOut: inMs + span };
  });

// Duplicate the clip immediately after its current position on the same track.
export const duplicateClip = (project: Project, clipId: ID): Project => {
  const clip = project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (clip && sequenceEditReason(project, [clip])) return project;
  let inserted = false;
  const tracks = project.timeline.tracks.map((tr) => {
    const idx = tr.clips.findIndex((c) => c.id === clipId);
    if (idx < 0) return tr;
    const original = tr.clips[idx]!;
    const copy = { ...original, id: newId(), start: original.start + original.duration };
    inserted = true;
    const next = [...tr.clips];
    next.splice(idx + 1, 0, copy as typeof original);
    return { ...tr, clips: next };
  });
  if (!inserted) return project;
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

// One copied clip together with the track it was copied from, so paste can
// put it back on the same track.
export interface ClipboardEntry {
  readonly trackId: ID;
  readonly clip: Clip;
}

// FCP-style paste (Cmd+V): place copies at `atMs`, preserving the copied
// clips' offsets relative to the earliest one. Copies get fresh ids, drop
// group membership, frame-snap, and clamp into free gaps so nothing
// overlaps. Entries whose track is gone or locked are skipped.
export const pasteClips = (
  project: Project,
  entries: readonly ClipboardEntry[],
  atMs: Ms,
): Project => {
  const eligible = entries.filter((e) => project.timeline.tracks.some((t) => t.id === e.trackId && !t.locked));
  if (entries.length === 0 || sequenceEditReason(project, eligible.map((e) => e.clip))) return project;
  const minStart = entries.reduce((m, e) => Math.min(m, e.clip.start), Number.POSITIVE_INFINITY);
  let tracks = project.timeline.tracks;
  let pasted = false;
  for (const { trackId, clip } of entries) {
    const track = tracks.find((t) => t.id === trackId);
    if (!track || track.locked) continue;
    const target = Math.max(0, snapMsToFrame(atMs + clip.start - minStart, project.framerate));
    const start = resolvePlacement(track.clips, clip.duration, target);
    const copy = { ...dropKey(clip, "groupId"), id: newId(), start } as Clip;
    const clips = [...track.clips, copy].sort((a, b) => a.start - b.start);
    tracks = tracks.map((t) => (t.id === trackId ? { ...t, clips } : t));
    pasted = true;
  }
  if (!pasted) return project;
  return recompute({ ...project, timeline: { ...project.timeline, tracks } });
};

// Apply an audio crossfade at the cut before `clipId`: fade out the previous
// adjacent clip's tail and fade in this clip's head over `durationMs`.
export const crossfadeWithPrevious = (
  project: Project,
  clipId: ID,
  durationMs: Ms,
): Project => {
  let prevId: ID | null = null;
  for (const t of project.timeline.tracks) {
    const sorted = [...t.clips].sort((a, b) => a.start - b.start);
    const idx = sorted.findIndex((c) => c.id === clipId);
    if (idx > 0) {
      prevId = sorted[idx - 1]!.id;
      break;
    }
    if (idx === 0) break;
  }
  let next = setAudioFade(project, clipId, { fadeInMs: durationMs });
  if (prevId) next = setAudioFade(next, prevId, { fadeOutMs: durationMs });
  return next;
};
