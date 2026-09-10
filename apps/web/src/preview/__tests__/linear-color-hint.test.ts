import {
  type MediaAsset,
  type MediaClip,
  type Project,
  type ShapeClip,
  createEmptyProject,
  newId,
} from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { LINEAR_COLOR_PIPELINE_SINCE, needsLinearColorMigrationHint } from "../linear-color-hint";

const OLD = LINEAR_COLOR_PIPELINE_SINCE - 1;
const NEW = LINEAR_COLOR_PIPELINE_SINCE;

const shape = (over: Partial<ShapeClip> = {}): ShapeClip => ({
  id: newId(),
  kind: "shape",
  shape: "rect",
  fill: "#ff0000",
  stroke: "#000000",
  strokeWidth: 0,
  start: 0,
  duration: 1000,
  speed: 1,
  effects: [],
  keyframes: [],
  ...over,
});
const blur = {
  id: newId(),
  type: "blur",
  enabled: true,
  params: {},
} as ShapeClip["effects"][number];

const project = (
  clips: readonly (ShapeClip | MediaClip)[],
  createdAt: number,
  mediaLibrary: readonly MediaAsset[] = [],
): Project => {
  const base = createEmptyProject({ createdAt });
  const tracks = base.timeline.tracks.map((t, i) => (i === 0 ? { ...t, clips } : t));
  return { ...base, mediaLibrary, timeline: { ...base.timeline, tracks } };
};
const hint = (p: Project) =>
  needsLinearColorMigrationHint({
    createdAt: p.createdAt,
    tracks: p.timeline.tracks,
    mediaLibrary: p.mediaLibrary,
    resolution: p.resolution,
  });

describe("needsLinearColorMigrationHint", () => {
  it("never hints on a project created after the linear pipeline landed", () => {
    expect(hint(project([shape(), shape({ start: 1000 })], NEW))).toBe(false);
    expect(hint(project([shape({ effects: [blur] })], NEW))).toBe(false);
  });

  it("hints on an older project whose look depends on blending or effects", () => {
    expect(hint(project([shape(), shape({ start: 1000 })], OLD))).toBe(true);
    expect(hint(project([shape({ effects: [blur] })], OLD))).toBe(true);
    const scaled = { x: 0, y: 0, scale: 0.5, rotation: 0, opacity: 1 };
    expect(hint(project([shape({ transform: scaled })], OLD))).toBe(true);
  });

  it("stays quiet on an older project with a single untouched clip", () => {
    expect(hint(project([shape()], OLD))).toBe(false);
    expect(hint(project([], OLD))).toBe(false);
  });

  it("counts a media clip whose asset differs from the project resolution", () => {
    const asset = {
      id: newId(),
      kind: "video",
      name: "a.mp4",
      mime: "video/mp4",
      width: 1280,
      height: 720,
      durationMs: 1000,
      importedAt: OLD,
      ref: { kind: "blob", blobKey: "k" },
    } as unknown as MediaAsset;
    const clip = {
      id: newId(),
      kind: "media",
      assetId: asset.id,
      trimIn: 0,
      start: 0,
      duration: 1000,
      speed: 1,
      effects: [],
      keyframes: [],
    } as unknown as MediaClip;
    expect(hint(project([clip], OLD, [asset]))).toBe(true);
    expect(hint(project([clip], NEW, [asset]))).toBe(false);
  });
});
