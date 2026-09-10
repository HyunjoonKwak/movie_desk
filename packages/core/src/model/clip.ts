import type { ID } from "../utils/id";
import type { Ms } from "../utils/time";
import type { EffectInstance } from "./effect";
import type { KeyframeTrack } from "./keyframe";
import type { Transition } from "./transition";

// Clip-local 2D transform. Normalized to the project canvas:
//   x, y are fractions of (w, h) where (0, 0) is centered. Range typically [-1, 1].
//   scale is uniform multiplier; 1.0 = native asset size.
//   rotation is radians around the clip center.
//   opacity in [0, 1].
export interface ClipTransform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
  readonly opacity: number;
}

export const IDENTITY_TRANSFORM: ClipTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

// Vector mask applied to a clip. Coordinates normalized 0..1 over the frame.
// `inverted` shows the outside instead of the inside; `feather` softens edges.
export interface ClipMask {
  readonly shape: "rect" | "ellipse";
  readonly x: number;        // top-left (rect) / center (ellipse handled in shader)
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly feather: number;  // 0..0.5
  readonly inverted: boolean;
}

// Compositing blend modes against the accumulated frame below, in UI order.
// This array is the single source of truth: the BlendMode type is derived from
// it, and the inspector renders straight from it. Adding a mode here is enough
// for the type, the picker and isBackdropBlend to agree — only the shader's
// u_mode switch and the i18n label need a matching entry.
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "add",
  "darken",
  "lighten",
  "overlay",
  "soft-light",
  "hard-light",
  "color-dodge",
  "color-burn",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

// The only modes expressible with fixed-function GL blend factors. Everything
// else has to read the backdrop in a shader, so this set is the whitelist and
// isBackdropBlend is its inverse — a newly added mode defaults to the shader
// path rather than silently falling through to blit and looking like "normal".
const FIXED_FUNCTION_BLEND: ReadonlySet<string> = new Set([
  "normal",
  "multiply",
  "screen",
  "add",
]);

// Modes that require sampling the captured backdrop (shader path).
export type BackdropBlendMode = Exclude<
  BlendMode,
  "normal" | "multiply" | "screen" | "add"
>;

const KNOWN_BLEND: ReadonlySet<string> = new Set(BLEND_MODES);

// Blend modes that require reading the backdrop (shader path, not GL blend func).
// Unknown strings answer false on purpose: project files are validated with a
// passthrough schema, so a mode written by a newer build can reach us here. The
// blit path renders those as "normal" instead of indexing the shader's mode map
// out of range.
export const isBackdropBlend = (m: BlendMode | undefined): m is BackdropBlendMode =>
  !!m && KNOWN_BLEND.has(m) && !FIXED_FUNCTION_BLEND.has(m);

export interface ClipBase {
  readonly id: ID;
  readonly start: Ms;          // start on the project timeline
  readonly duration: Ms;       // length on the project timeline (after speed)
  readonly speed: number;      // 1.0 = normal, supports negative for reverse
  readonly transform?: ClipTransform;  // optional; null/undefined = identity
  readonly mask?: ClipMask;    // optional vector mask
  readonly blendMode?: BlendMode;  // optional; undefined = "normal"
  readonly disabled?: boolean;     // when true, excluded from render & mix
  readonly groupId?: ID;           // clips sharing a groupId move together
  readonly effects: readonly EffectInstance[];
  readonly keyframes: readonly KeyframeTrack[];
  readonly transitionIn?: Transition;
  readonly transitionOut?: Transition;
  readonly label?: string;
  readonly color?: string;
}

// Always read transform through this helper so persisted clips that
// predate Phase 19 don't crash.
export const clipTransform = (c: { transform?: ClipTransform }): ClipTransform =>
  c.transform ?? IDENTITY_TRANSFORM;

// How a media source is fitted into the project frame when their aspect ratios
// differ. "stretch" (default) distorts to fill; "fill" center-crops to cover;
// "fit" letterboxes to contain.
export type SpatialFit = "stretch" | "fill" | "fit";

export interface MediaClip extends ClipBase {
  readonly kind: "media";
  readonly preservePitch?: boolean; // opt-in; missing retains legacy varispeed
  readonly assetId: ID;
  readonly trimIn: Ms;         // offset within source asset
  readonly trimOut: Ms;        // end offset within source asset (exclusive)
  readonly volume?: number;    // audio gain, 0..1+
  readonly freeze?: Ms;        // when set, hold this source frame for the whole clip
  readonly fit?: SpatialFit;   // aspect conform; undefined = "stretch"
}

export type TextAnimation =
  | "none"
  | "fade"
  | "typewriter"
  | "slide-up"
  | "slide-down"
  | "pop";

export type TextAlign = "left" | "center" | "right";

export interface TextClip extends ClipBase {
  readonly kind: "text";
  readonly text: string;
  readonly font: string;
  readonly size: number;
  readonly color: string;
  readonly bgColor?: string;
  readonly weight?: number;   // font weight (400 normal, 700 bold), default 400
  readonly align?: TextAlign; // horizontal alignment, default "center"
  readonly strokeColor?: string;  // text outline color
  readonly strokeWidth?: number;  // text outline width in px, 0 = none
  readonly shadow?: boolean;      // drop shadow on/off (default on)
  readonly shadowBlur?: number;   // shadow blur radius in px
  readonly shadowColor?: string;  // shadow color (default semi-black)
  readonly animIn?: TextAnimation;
  readonly animOut?: TextAnimation;
  readonly animMs?: Ms;       // animation duration, default 500
}

export type ShapeKind = "rect" | "ellipse" | "line";

export type ShapeFillType = "solid" | "linear" | "radial";

export interface ShapeClip extends ClipBase {
  readonly kind: "shape";
  readonly shape: ShapeKind;
  readonly fill: string;       // hex or "transparent" (solid fill / gradient start)
  readonly stroke: string;     // hex
  readonly strokeWidth: number;
  readonly cornerRadius?: number; // rect only
  readonly fillType?: ShapeFillType;  // default "solid"
  readonly fillColor2?: string;       // gradient end color
  readonly gradientAngle?: number;    // linear gradient angle in degrees
}

// Adjustment layer: has no source of its own. Its effect chain is applied to
// the composited frame beneath it, optionally limited by a mask and opacity.
export interface AdjustmentClip extends ClipBase {
  readonly kind: "adjustment";
}

export interface SequenceClip extends ClipBase {
  readonly kind: "sequence";
  // Same contract as MediaClip: opt-in, and a document without the field keeps
  // the varispeed a compound has always had.
  readonly preservePitch?: boolean;
  readonly timelineId: ID;
  readonly trimIn: Ms;
  readonly trimOut: Ms;
  readonly volume?: number;
}

export type Clip = MediaClip | TextClip | ShapeClip | AdjustmentClip | SequenceClip;

export const isSequenceClip = (c: Clip): c is SequenceClip => c.kind === "sequence";

// Source-window edits apply to both file-backed media and nested timelines.
export const hasSourceTrim = (c: Clip): c is MediaClip | SequenceClip => "trimIn" in c;

export const isMediaClip = (c: Clip): c is MediaClip => c.kind === "media";
export const isTextClip = (c: Clip): c is TextClip => c.kind === "text";
export const isShapeClip = (c: Clip): c is ShapeClip => c.kind === "shape";
export const isAdjustmentClip = (c: Clip): c is AdjustmentClip => c.kind === "adjustment";

export const clipEnd = (c: Clip): Ms => c.start + c.duration;
