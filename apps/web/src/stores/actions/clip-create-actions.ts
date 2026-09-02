import {
  addClip,
  addTrackAt,
  newId,
  updateClip,
  type ID,
  type Project,
  type ShapeClip,
  type ShapeKind,
  type TextAlign,
  type TextAnimation,
  type Track,
} from "@movie-desk/core";
import { runWith, type ProjectMutating, type SetFn } from "../store-helpers";

// Reserved lanes are owned by generators (SRT import wipes "Subtitles"
// wholesale, auto-edit rerun deletes every "AUTO " track) — manual clips
// must never land on them or they'd be silently destroyed later.
const isReservedTrack = (t: Track): boolean =>
  t.name === "Subtitles" || t.name.startsWith("AUTO ");

// Overlay-family clips (text, titles, shapes, adjustment layers) must sit
// ABOVE the primary video track — earlier array index composites on top —
// or they'd be hidden behind its media clips. Reuse the topmost suitable
// track above the primary, else insert a fresh one at the very top.
const resolveUpperTrack = (
  p: Project,
  kind: "text" | "overlay",
  name: string,
): { proj: Project; track: Track } => {
  const primaryIdx = p.timeline.tracks.findIndex((t) => t.kind === "video" && !t.connected);
  const limit = primaryIdx < 0 ? p.timeline.tracks.length : primaryIdx;
  const existing = p.timeline.tracks
    .slice(0, limit)
    .find((t) => t.kind === kind && !t.locked && !isReservedTrack(t));
  if (existing) return { proj: p, track: existing };
  const proj = addTrackAt(
    p,
    { kind, name, height: kind === "text" ? 48 : 60, muted: false, solo: false, locked: false },
    0,
  );
  return { proj, track: proj.timeline.tracks[0]! };
};

// Which built-in title layout to drop at the playhead.
export type TitleTemplate = "title" | "subtitle" | "lowerThird";

// Text / shape / adjustment clip creation plus inline text & shape editing.
// Extracted from project-store so that file stays focused on timeline editing,
// drag sessions, and history. All actions route through `runWith`, so undo /
// redo stays free.
export interface ClipCreateActions {
  addTextClipAtPlayhead: (text?: string) => void;
  addTitleTemplate: (kind: TitleTemplate) => void;
  updateTextClip: (
    clipId: ID,
    patch: {
      text?: string;
      size?: number;
      color?: string;
      bgColor?: string | undefined;
      font?: string;
      weight?: number;
      align?: TextAlign;
      strokeColor?: string;
      strokeWidth?: number;
      shadow?: boolean;
      shadowBlur?: number;
      animIn?: string;
      animOut?: string;
      animMs?: number;
    },
  ) => void;
  addShapeClipAtPlayhead: (shape: ShapeKind) => void;
  addAdjustmentClipAtPlayhead: () => void;
  updateShapeClip: (
    clipId: ID,
    patch: Partial<
      Pick<
        ShapeClip,
        | "shape"
        | "fill"
        | "stroke"
        | "strokeWidth"
        | "cornerRadius"
        | "fillType"
        | "fillColor2"
        | "gradientAngle"
      >
    >,
  ) => void;
}

export const createClipCreateActions = <S extends ProjectMutating>(
  set: SetFn<S>,
): ClipCreateActions => ({
  addTextClipAtPlayhead: (text = "Title") =>
    runWith(set, "Add text", (p) => {
      const { proj: projectAfter, track: textTrack } = resolveUpperTrack(
        p,
        "text",
        `T${p.timeline.tracks.filter((t) => t.kind === "text").length + 1}`,
      );
      return addClip(projectAfter, textTrack.id, {
        kind: "text",
        id: newId(),
        start: projectAfter.timeline.playhead,
        duration: 3000,
        speed: 1,
        effects: [],
        keyframes: [],
        text,
        font: "Inter, system-ui, sans-serif",
        size: 96,
        color: "#ffffff",
      });
    }),

  addTitleTemplate: (kind) =>
    runWith(set, "Add title template", (p) => {
      const at = p.timeline.playhead;
      const { proj, track } = resolveUpperTrack(p, "overlay", "FX");
      const baseText = {
        kind: "text" as const,
        start: at,
        duration: 4000,
        speed: 1,
        effects: [],
        keyframes: [],
        font: "Inter, system-ui, sans-serif",
        color: "#ffffff",
        animMs: 500,
      };
      if (kind === "title") {
        return addClip(proj, track.id, {
          ...baseText,
          id: newId(),
          text: "Title",
          size: 112,
          align: "center",
          animIn: "fade",
          animOut: "fade",
          transform: { x: 0, y: 0.05, scale: 1, rotation: 0, opacity: 1 },
        });
      }
      if (kind === "subtitle") {
        return addClip(proj, track.id, {
          ...baseText,
          id: newId(),
          text: "Subtitle",
          size: 46,
          align: "center",
          animIn: "fade",
          animOut: "fade",
          transform: { x: 0, y: -0.72, scale: 1, rotation: 0, opacity: 1 },
        });
      }
      // lower-third: a semi-transparent backing bar plus left-aligned text.
      // Same-start clips draw earliest-added on top (compositor reverses the
      // track-order list), so the text goes in FIRST, the bar behind it.
      const withText = addClip(proj, track.id, {
        ...baseText,
        id: newId(),
        text: "Name\nRole / Title",
        size: 40,
        align: "left",
        animIn: "slide-up",
        transform: { x: -0.22, y: -0.58, scale: 1, rotation: 0, opacity: 1 },
      });
      return addClip(withText, track.id, {
        kind: "shape",
        id: newId(),
        start: at,
        duration: 4000,
        speed: 1,
        effects: [],
        keyframes: [],
        shape: "rect",
        fill: "rgba(0,0,0,0.55)",
        stroke: "transparent",
        strokeWidth: 0,
        cornerRadius: 12,
        transform: { x: -0.12, y: -0.58, scale: 0.6, rotation: 0, opacity: 1 },
      });
    }),

  updateTextClip: (clipId, patch) =>
    runWith(set, "Edit text", (p) =>
      updateClip(p, clipId, (c) =>
        c.kind === "text"
          ? {
              ...c,
              ...(patch.text !== undefined ? { text: patch.text } : {}),
              ...(patch.size !== undefined ? { size: patch.size } : {}),
              ...(patch.color !== undefined ? { color: patch.color } : {}),
              ...(patch.bgColor !== undefined ? { bgColor: patch.bgColor } : {}),
              ...(patch.font !== undefined ? { font: patch.font } : {}),
              ...(patch.weight !== undefined ? { weight: patch.weight } : {}),
              ...(patch.align !== undefined ? { align: patch.align } : {}),
              ...(patch.strokeColor !== undefined ? { strokeColor: patch.strokeColor } : {}),
              ...(patch.strokeWidth !== undefined ? { strokeWidth: patch.strokeWidth } : {}),
              ...(patch.shadow !== undefined ? { shadow: patch.shadow } : {}),
              ...(patch.shadowBlur !== undefined ? { shadowBlur: patch.shadowBlur } : {}),
              ...(patch.animIn !== undefined ? { animIn: patch.animIn as TextAnimation } : {}),
              ...(patch.animOut !== undefined ? { animOut: patch.animOut as TextAnimation } : {}),
              ...(patch.animMs !== undefined ? { animMs: patch.animMs } : {}),
            }
          : c,
      ),
    ),

  addShapeClipAtPlayhead: (shape) =>
    runWith(set, "Add shape", (p) => {
      const { proj: projectAfter, track } = resolveUpperTrack(p, "overlay", "FX");
      return addClip(projectAfter, track.id, {
        kind: "shape",
        id: newId(),
        start: projectAfter.timeline.playhead,
        duration: 3000,
        speed: 1,
        effects: [],
        keyframes: [],
        shape,
        fill: "#6366f1",
        stroke: "#ffffff",
        strokeWidth: shape === "line" ? 6 : 0,
        ...(shape === "rect" ? { cornerRadius: 0 } : {}),
      });
    }),

  addAdjustmentClipAtPlayhead: () =>
    runWith(set, "Add adjustment layer", (p) => {
      // Adjustment layers grade everything drawn beneath them, so they must
      // sit above the primary video track to have any effect.
      const { proj: projectAfter, track } = resolveUpperTrack(p, "overlay", "FX");
      return addClip(projectAfter, track.id, {
        kind: "adjustment",
        id: newId(),
        start: projectAfter.timeline.playhead,
        duration: 3000,
        speed: 1,
        effects: [],
        keyframes: [],
      });
    }),

  updateShapeClip: (clipId, patch) =>
    runWith(set, "Edit shape", (p) =>
      updateClip(p, clipId, (c) =>
        c.kind === "shape"
          ? {
              ...c,
              ...(patch.shape !== undefined ? { shape: patch.shape } : {}),
              ...(patch.fill !== undefined ? { fill: patch.fill } : {}),
              ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}),
              ...(patch.strokeWidth !== undefined ? { strokeWidth: patch.strokeWidth } : {}),
              ...(patch.cornerRadius !== undefined ? { cornerRadius: patch.cornerRadius } : {}),
              ...(patch.fillType !== undefined ? { fillType: patch.fillType } : {}),
              ...(patch.fillColor2 !== undefined ? { fillColor2: patch.fillColor2 } : {}),
              ...(patch.gradientAngle !== undefined ? { gradientAngle: patch.gradientAngle } : {}),
            }
          : c,
      ),
    ),
});
