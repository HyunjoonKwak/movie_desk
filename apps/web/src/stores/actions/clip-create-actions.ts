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
import { DEFAULT_TEXT_FONT } from "@/editor/fonts";
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
export type TitleTemplate =
  | "title"
  | "subtitle"
  | "lowerThird"
  | "travelTitle"
  | "chapterCard"
  | "growthTitle";

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
        font: DEFAULT_TEXT_FONT,
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
        font: DEFAULT_TEXT_FONT,
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
      if (kind === "travelTitle") {
        const groupId = newId();
        const withText = addClip(proj, track.id, {
          ...baseText,
          id: newId(),
          groupId,
          text: "여행의 순간\n강릉 · 2026",
          font: DEFAULT_TEXT_FONT,
          size: 72,
          weight: 700,
          align: "left",
          shadow: true,
          shadowBlur: 18,
          animIn: "slide-up",
          animOut: "fade",
          transform: { x: 0.1, y: 0.2, scale: 1, rotation: 0, opacity: 1 },
        });
        return addClip(withText, track.id, {
          kind: "shape",
          id: newId(),
          groupId,
          start: at,
          duration: 4000,
          speed: 1,
          effects: [],
          keyframes: [],
          shape: "rect",
          fill: "rgba(8,47,73,0.82)",
          fillType: "linear",
          fillColor2: "rgba(15,118,110,0.7)",
          gradientAngle: 25,
          stroke: "rgba(255,255,255,0.18)",
          strokeWidth: 2,
          cornerRadius: 24,
          transform: { x: -0.12, y: 0.2, scale: 0.82, rotation: 0, opacity: 1 },
        });
      }
      if (kind === "chapterCard") {
        const groupId = newId();
        const withText = addClip(proj, track.id, {
          ...baseText,
          id: newId(),
          groupId,
          text: "DAY 01\n강릉",
          font: DEFAULT_TEXT_FONT,
          size: 68,
          weight: 700,
          align: "left",
          color: "#f8fafc",
          shadow: false,
          animIn: "fade",
          animOut: "fade",
          transform: { x: 0.12, y: 0, scale: 1, rotation: 0, opacity: 1 },
        });
        return addClip(withText, track.id, {
          kind: "shape",
          id: newId(),
          groupId,
          start: at,
          duration: 4000,
          speed: 1,
          effects: [],
          keyframes: [],
          shape: "rect",
          fill: "rgba(15,23,42,0.78)",
          stroke: "#38d0c4",
          strokeWidth: 4,
          cornerRadius: 18,
          transform: { x: -0.12, y: 0, scale: 0.7, rotation: 0, opacity: 1 },
        });
      }
      if (kind === "growthTitle") {
        const groupId = newId();
        const withText = addClip(proj, track.id, {
          ...baseText,
          id: newId(),
          groupId,
          text: "우리의 성장 기록\n2026",
          font: DEFAULT_TEXT_FONT,
          size: 76,
          weight: 700,
          align: "center",
          color: "#fff7ed",
          shadow: true,
          shadowBlur: 22,
          animIn: "pop",
          animOut: "fade",
          transform: { x: 0, y: 0.04, scale: 1, rotation: 0, opacity: 1 },
        });
        return addClip(withText, track.id, {
          kind: "shape",
          id: newId(),
          groupId,
          start: at,
          duration: 4000,
          speed: 1,
          effects: [],
          keyframes: [],
          shape: "rect",
          fill: "rgba(120,53,15,0.5)",
          fillType: "radial",
          fillColor2: "rgba(69,10,10,0.75)",
          stroke: "rgba(254,215,170,0.65)",
          strokeWidth: 3,
          cornerRadius: 28,
          transform: { x: 0, y: 0.02, scale: 0.82, rotation: 0, opacity: 1 },
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
        transform: { x: 0.16, y: -0.58, scale: 1, rotation: 0, opacity: 1 },
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
