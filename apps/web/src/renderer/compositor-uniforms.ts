// Stateless uniform-setting helpers shared by every compositor pass. Splitting
// them out keeps compositor.ts focused on orchestration and lets us hand-tune
// the hot path uniforms in one place.

import {
  sampleKeyframes,
  type BackdropBlendMode,
  type Clip,
  type EffectInstance,
  type Project,
  type TransitionFrame,
  type TransitionType,
} from "@movie-desk/core";
import type { GL } from "./gl";
import type { Program } from "./shader-registry";

// Directional wipe → integer u_wipe_mode value the blit shader expects.
const WIPE_MODE: Partial<Record<TransitionType, number>> = {
  "wipe-left": 1,
  wipe: 1,
  "wipe-right": 2,
  "wipe-up": 3,
  "wipe-down": 4,
  "wipe-circle": 5,
};

// Backdrop blend mode → integer u_mode value the blend-modes shader switches
// on. Deliberately a total Record and not a Partial one: adding a mode to
// BLEND_MODES without a value here is a type error, whereas a Partial map
// would need a `?? 0` fallback and would quietly render the new mode as
// overlay. The GLSL side has no compiler to enforce the other half of this
// contract, so blend-modes.test.ts checks the cases exist in the source.
export const BACKDROP_BLEND_MODE: Record<BackdropBlendMode, number> = {
  overlay: 0,
  "soft-light": 1,
  darken: 2,
  lighten: 3,
  "hard-light": 4,
  "color-dodge": 5,
  "color-burn": 6,
  difference: 7,
  exclusion: 8,
  hue: 9,
  saturation: 10,
  color: 11,
  luminosity: 12,
};

export interface ClipTf {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
  readonly opacity: number;
}

export const setMaskUniforms = (gl: GL, prog: Program, mask: Clip["mask"]): void => {
  const shapeLoc = prog.uniform("u_mask_shape");
  if (!mask) {
    if (shapeLoc) gl.uniform1i(shapeLoc, 0);
    return;
  }
  if (shapeLoc) gl.uniform1i(shapeLoc, mask.shape === "rect" ? 1 : 2);
  const rectLoc = prog.uniform("u_mask_rect");
  if (rectLoc) gl.uniform4f(rectLoc, mask.x, mask.y, mask.w, mask.h);
  const featherLoc = prog.uniform("u_mask_feather");
  if (featherLoc) gl.uniform1f(featherLoc, mask.feather);
  const invLoc = prog.uniform("u_mask_inverted");
  if (invLoc) gl.uniform1i(invLoc, mask.inverted ? 1 : 0);
};

export const setWipeUniforms = (gl: GL, prog: Program, wipe: TransitionFrame | null): void => {
  const modeLoc = prog.uniform("u_wipe_mode");
  const progLoc = prog.uniform("u_wipe_progress");
  const softLoc = prog.uniform("u_wipe_softness");
  const mode = wipe ? WIPE_MODE[wipe.type] ?? 1 : 0;
  if (modeLoc) gl.uniform1i(modeLoc, mode);
  if (progLoc) gl.uniform1f(progLoc, wipe ? wipe.progress : 1);
  if (softLoc) gl.uniform1f(softLoc, 0.04);
};

export const setTransformUniforms = (gl: GL, prog: Program, tf: ClipTf): void => {
  const dest = prog.uniform("u_dest");
  if (dest) gl.uniform4f(dest, 0, 0, 1, 1);
  const opacity = prog.uniform("u_opacity");
  if (opacity) gl.uniform1f(opacity, tf.opacity);
  const translate = prog.uniform("u_translate");
  if (translate) gl.uniform2f(translate, tf.x * 2, tf.y * -2); // y down → flip
  const scale = prog.uniform("u_scale");
  if (scale) gl.uniform1f(scale, tf.scale);
  const rotation = prog.uniform("u_rotation");
  if (rotation) gl.uniform1f(rotation, tf.rotation);
  const aspect = prog.uniform("u_aspect");
  if (aspect) gl.uniform1f(aspect, gl.drawingBufferWidth / gl.drawingBufferHeight);
};

// Picks fixed-function GL blend factors for the clip's blend mode. Source
// colors are premultiplied, so each pair both composites and respects alpha
// (transparent regions pass the backdrop through unchanged).
export const setBlendMode = (gl: GL, mode: Clip["blendMode"]): void => {
  switch (mode) {
    case "add":
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      break;
    case "multiply":
      gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      break;
    case "screen":
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      break;
    default:
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
};

// Resolves keyframe-driven effect-param overrides for a clip at the current
// playhead. Returns the animated effect list plus the raw keyframe values
// (the caller maps transform.* values onto the composite transform).
export const animateEffects = (
  clip: Clip,
  project: Project,
): { effects: readonly EffectInstance[]; kfValues: Readonly<Record<string, number>> } => {
  const kfValues = sampleKeyframes(
    clip.keyframes,
    Math.max(0, project.timeline.playhead - clip.start),
  );
  const effects = clip.effects.map((e) => {
    const overrides: Record<string, number | string | boolean> = {};
    let touched = false;
    for (const [target, value] of Object.entries(kfValues)) {
      const prefix = `effects.${e.id}.`;
      if (target.startsWith(prefix)) {
        overrides[target.slice(prefix.length)] = value;
        touched = true;
      }
    }
    return touched ? { ...e, params: { ...e.params, ...overrides } } : e;
  });
  return { effects, kfValues };
};
