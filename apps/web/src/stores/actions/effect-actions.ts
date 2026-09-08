import { editActiveTimeline } from "../active-timeline";
import { listEffects } from "@/effects/registry";
import {
  addEffectToClip,
  newId,
  removeEffectFromClip,
  reorderEffect,
  setEffectParam,
  toggleEffectEnabled,
  upsertEffect,
} from "@movie-desk/core";
import type { EffectParamValue, ID, Project } from "@movie-desk/core";
import { type ProjectMutating, type SetFn, runWith } from "../store-helpers";

export interface EffectActions {
  addEffect: (clipId: ID, type: string) => void;
  removeEffect: (clipId: ID, effectId: ID) => void;
  toggleEffect: (clipId: ID, effectId: ID) => void;
  reorderEffectById: (clipId: ID, effectId: ID, toIndex: number) => void;
  // Slider drags bypass history; discrete LUT interpretation/import choices commit.
  setEffectParamValue: (clipId: ID, effectId: ID, key: string, value: EffectParamValue) => void;
  upsertEffectFor: (clipId: ID, type: string, params: Record<string, EffectParamValue>) => void;
}

export const createEffectActions = <S extends ProjectMutating>(set: SetFn<S>): EffectActions => ({
  addEffect: (clipId, type) =>
    runWith(set, `Add effect: ${type}`, (p) => {
      const def = listEffects().find((d) => d.type === type);
      if (!def) return p;
      const params = Object.fromEntries(def.params.map((pp) => [pp.key, pp.default]));
      return addEffectToClip(p, clipId, { id: newId(), type, enabled: true, params });
    }),

  removeEffect: (clipId, effectId) =>
    runWith(set, "Remove effect", (p) => removeEffectFromClip(p, clipId, effectId)),

  toggleEffect: (clipId, effectId) =>
    runWith(set, "Toggle effect", (p) => toggleEffectEnabled(p, clipId, effectId)),

  reorderEffectById: (clipId, effectId, toIndex) =>
    runWith(set, "Reorder effect", (p) => reorderEffect(p, clipId, effectId, toIndex)),

  setEffectParamValue: (clipId, effectId, key, value) => {
    if (key === "colorSpace" || key === "lutId") {
      runWith(set, "Change LUT interpretation", (p) =>
        setEffectParam(p, clipId, effectId, key, value),
      );
    } else {
      set(
        (s) => ({ project: editActiveTimeline(s.project, (p) => setEffectParam(p, clipId, effectId, key, value)) }) as Partial<S>,
      );
    }
  },

  upsertEffectFor: (clipId, type, params) =>
    runWith(set, "Apply effect", (p: Project) => upsertEffect(p, clipId, type, params)),
});
