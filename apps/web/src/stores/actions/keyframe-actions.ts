import {
  upsertClipKeyframe,
  removeClipKeyframe,
  clearClipKeyframes,
  setClipKeyframes,
  setClipKeyframeEasing,
} from "@movie-desk/core";
import type { BezierHandles, EasingFn, ID, KeyframeTrack, Ms } from "@movie-desk/core";
import { runWith, type ProjectMutating, type SetFn } from "../store-helpers";

export interface KeyframeActions {
  addKeyframe: (clipId: ID, target: string, atMs: Ms, value: number) => void;
  removeKeyframe: (clipId: ID, target: string, atMs: Ms) => void;
  clearKeyframeTrack: (clipId: ID, target: string) => void;
  pasteKeyframesTo: (clipId: ID, tracks: readonly KeyframeTrack[]) => void;
  setKeyframeEasing: (
    clipId: ID,
    target: string,
    atMs: Ms,
    easing: EasingFn,
    bezier?: BezierHandles,
  ) => void;
}

export const createKeyframeActions = <S extends ProjectMutating>(set: SetFn<S>): KeyframeActions => ({
  addKeyframe: (clipId, target, atMs, value) =>
    runWith(set, "Add keyframe", (p) => upsertClipKeyframe(p, clipId, target, atMs, value)),
  removeKeyframe: (clipId, target, atMs) =>
    runWith(set, "Remove keyframe", (p) => removeClipKeyframe(p, clipId, target, atMs)),
  clearKeyframeTrack: (clipId, target) =>
    runWith(set, "Clear keyframes", (p) => clearClipKeyframes(p, clipId, target)),
  pasteKeyframesTo: (clipId, tracks) =>
    runWith(set, "Paste keyframes", (p) => setClipKeyframes(p, clipId, tracks)),
  setKeyframeEasing: (clipId, target, atMs, easing, bezier) =>
    runWith(set, "Set keyframe easing", (p) =>
      setClipKeyframeEasing(p, clipId, target, atMs, easing, bezier),
    ),
});
