// Effect chain ops on a clip: add/remove/reorder, toggle enabled, set a
// single param, and the upsert/audio-fade convenience wrappers used by the
// crossfade + auto-WB flows.

import type { EffectInstance, EffectParamValue } from "../model/effect";
import type { Project } from "../model/project";
import type { ID } from "../utils/id";
import { newId } from "../utils/id";
import { updateClip } from "./mutate-core";

export const addEffectToClip = (project: Project, clipId: ID, effect: EffectInstance): Project =>
  updateClip(project, clipId, (c) => ({ ...c, effects: [...c.effects, effect] }));

export const removeEffectFromClip = (project: Project, clipId: ID, effectId: ID): Project => {
  const clip = project.timeline.tracks.flatMap((track) => track.clips).find((c) => c.id === clipId);
  if (!clip?.effects.some((effect) => effect.id === effectId)) return project;
  return updateClip(project, clipId, (c) => ({
    ...c,
    effects: c.effects.filter((e) => e.id !== effectId),
  }));
};

export const setEffectParam = (
  project: Project,
  clipId: ID,
  effectId: ID,
  key: string,
  value: EffectParamValue,
): Project =>
  updateClip(project, clipId, (c) => ({
    ...c,
    effects: c.effects.map((e) =>
      e.id === effectId ? { ...e, params: { ...e.params, [key]: value } } : e,
    ),
  }));

export const toggleEffectEnabled = (project: Project, clipId: ID, effectId: ID): Project => {
  const clip = project.timeline.tracks.flatMap((track) => track.clips).find((c) => c.id === clipId);
  if (!clip?.effects.some((effect) => effect.id === effectId)) return project;
  return updateClip(project, clipId, (c) => ({
    ...c,
    effects: c.effects.map((e) => (e.id === effectId ? { ...e, enabled: !e.enabled } : e)),
  }));
};

// Move an existing effect within a clip's effect array to a new index. Used
// by the inspector's drag-to-reorder list.
export const reorderEffect = (
  project: Project,
  clipId: ID,
  effectId: ID,
  toIndex: number,
): Project => {
  const clip = project.timeline.tracks.flatMap((track) => track.clips).find((c) => c.id === clipId);
  const from = clip?.effects.findIndex((effect) => effect.id === effectId) ?? -1;
  if (!clip || from < 0) return project;
  const destination = Math.max(0, Math.min(clip.effects.length - 1, toIndex));
  if (from === destination) return project;
  return updateClip(project, clipId, (c) => {
    const from = c.effects.findIndex((e) => e.id === effectId);
    const next = [...c.effects];
    const [moved] = next.splice(from, 1);
    next.splice(destination, 0, moved!);
    return { ...c, effects: next };
  });
};

// Merge params into the first effect of `type` on a clip, adding the effect
// if none exists. Returns the project unchanged when the clip is missing.
export const upsertEffect = (
  project: Project,
  clipId: ID,
  type: string,
  params: Readonly<Record<string, EffectParamValue>>,
): Project =>
  updateClip(project, clipId, (c) => {
    const existing = c.effects.find((e) => e.type === type);
    if (existing) {
      const merged: EffectInstance = {
        ...existing,
        enabled: true,
        params: { ...existing.params, ...params },
      };
      return { ...c, effects: c.effects.map((e) => (e.id === existing.id ? merged : e)) };
    }
    const fx: EffectInstance = { id: newId(), type, enabled: true, params };
    return { ...c, effects: [...c.effects, fx] };
  });

// Merge fade-in/out into a clip's audio-fade effect, creating one if absent.
export const setAudioFade = (
  project: Project,
  clipId: ID,
  fade: { fadeInMs?: number; fadeOutMs?: number },
): Project =>
  updateClip(project, clipId, (c) => {
    const existing = c.effects.find((e) => e.type === "audio-fade");
    if (existing) {
      const merged: EffectInstance = {
        ...existing,
        enabled: true,
        params: { ...existing.params, ...fade },
      };
      return { ...c, effects: c.effects.map((e) => (e.id === existing.id ? merged : e)) };
    }
    const fx: EffectInstance = {
      id: newId(),
      type: "audio-fade",
      enabled: true,
      params: { fadeInMs: 0, fadeOutMs: 0, ...fade },
    };
    return { ...c, effects: [...c.effects, fx] };
  });
