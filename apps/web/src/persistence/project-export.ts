import type { Project } from "@movie-desk/core";
import { PROJECT_VERSION, isSafeRelativePath } from "@movie-desk/core";
import { z } from "zod";

// JSON envelope so we can evolve the on-disk format independently of the
// in-memory Project type.
export interface ProjectExport {
  // Wire identifier stays stable so older and renamed builds interoperate.
  readonly schema: "cut_editor-project";
  readonly version: number;
  readonly exportedAt: number;
  readonly project: Project;
}

// Structural validation of the load-bearing fields. `.passthrough()` keeps
// optional/extra fields (transforms, keyframes, effect params, proxy paths)
// without enumerating the whole model, while still rejecting a file whose
// tracks/clips/assets are missing their core shape — the gap that previously
// let superficially-valid-but-corrupt files into the store and IndexedDB.
const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const positive = finite.positive();
const effectParamSchema = z.union([finite, z.string(), z.boolean()]);
const effectSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    enabled: z.boolean(),
    params: z.record(effectParamSchema),
  })
  .passthrough();
const keyframeSchema = z
  .object({
    at: nonNegative,
    value: finite,
    easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out", "step", "bezier"]),
  })
  .passthrough();
const keyframeTrackSchema = z
  .object({
    target: z.string().min(1),
    keyframes: z.array(keyframeSchema),
  })
  .passthrough();
const clipBase = {
  id: z.string().min(1),
  start: nonNegative,
  duration: positive,
  speed: finite,
  effects: z.array(effectSchema),
  keyframes: z.array(keyframeTrackSchema),
};
const clipSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...clipBase,
      kind: z.literal("media"),
      assetId: z.string().min(1),
      trimIn: nonNegative,
      trimOut: nonNegative,
    })
    .passthrough(),
  z
    .object({
      ...clipBase,
      kind: z.literal("text"),
      text: z.string(),
      font: z.string().min(1),
      size: positive,
      color: z.string().min(1),
    })
    .passthrough(),
  z
    .object({
      ...clipBase,
      kind: z.literal("shape"),
      shape: z.enum(["rect", "ellipse", "line"]),
      fill: z.string(),
      stroke: z.string(),
      strokeWidth: nonNegative,
    })
    .passthrough(),
  z.object({ ...clipBase, kind: z.literal("adjustment") }).passthrough(),
]);

const trackSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["video", "audio", "text", "overlay"]),
    name: z.string(),
    height: positive,
    muted: z.boolean(),
    solo: z.boolean(),
    locked: z.boolean(),
    connected: z.boolean().optional(),
    clips: z.array(clipSchema),
  })
  .passthrough();

const rootSnapshotSchema = z
  .object({
    volumeUuid: z.string().optional(),
    volumeRelativePath: z.string().optional(),
    lastKnownAbsolutePath: z.string().optional(),
  })
  .passthrough();

// D1 source reference. Additive: assets without it are legacy OPFS copies.
const sourceRefSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("disk"),
      version: z.literal(1),
      rootId: z.string().min(1),
      rootSnapshot: rootSnapshotSchema,
      relativePath: z
        .string()
        .min(1)
        .refine(isSafeRelativePath, { message: "relativePath must stay inside its root" }),
      sizeBytes: nonNegative,
      modifiedAtMs: nonNegative,
      inode: z.string().optional(),
      quickHash: z.string().optional(),
      fullHash: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("opfs"),
      version: z.literal(1),
      key: z.string().min(1),
      sizeBytes: nonNegative.optional(),
    })
    .passthrough(),
]);

const mediaAssetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(["video", "audio", "image"]),
    mime: z.string(),
    durationMs: nonNegative,
    opfsPath: z.string().min(1),
    sourceRef: sourceRefSchema.optional(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    importedAt: z.number().int().nonnegative(),
  })
  .passthrough();

const markerSchema = z
  .object({
    id: z.string().min(1),
    at: nonNegative,
    endMs: nonNegative.optional(),
    label: z.string(),
    color: z.string().min(1),
  })
  .passthrough();

const projectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    framerate: positive,
    resolution: z.object({ w: positive, h: positive }).passthrough(),
    timeline: z
      .object({
        tracks: z.array(trackSchema),
        playhead: nonNegative,
        zoom: positive,
        // Legacy field — accepted from pre-removal exports (and re-added on
        // export as a wire-compat shim) but stripped from the runtime model.
        magnetic: z.boolean().optional(),
        duration: nonNegative,
        markers: z.array(markerSchema).optional(),
      })
      .passthrough()
      .transform(({ magnetic: _legacy, ...rest }) => rest),
    mediaLibrary: z.array(mediaAssetSchema),
  })
  .passthrough() as unknown as z.ZodType<Project>;

const exportSchema = z.object({
  schema: z.literal("cut_editor-project"),
  version: z.number().int(),
  exportedAt: z.number().int(),
  project: projectSchema,
});

export const parseStoredProject = (raw: unknown): Project => projectSchema.parse(raw);

export const toProjectExport = (project: Project): ProjectExport => ({
  schema: "cut_editor-project",
  version: PROJECT_VERSION,
  exportedAt: Date.now(),
  // Wire-compat shim (mirrors the CRDT one): `magnetic` left the model but
  // older builds' schemas still require the boolean to import the file.
  project: { ...project, timeline: { ...project.timeline, magnetic: true } } as Project,
});

export const parseProjectExport = (raw: unknown): ProjectExport => {
  const env = exportSchema.parse(raw);
  // Refuse a file written by a newer app version rather than silently importing
  // a format we don't understand. Older versions would migrate here; v1 is
  // currently the only version.
  if (env.version !== PROJECT_VERSION) {
    if (env.version < PROJECT_VERSION) {
      throw new Error(
        `This project uses an unsupported older format (file v${env.version}, this app v${PROJECT_VERSION}).`,
      );
    }
    throw new Error(
      `This project needs a newer version of the app (file v${env.version}, this app v${PROJECT_VERSION}).`,
    );
  }
  return env;
};

export const downloadProjectJson = (project: Project): void => {
  const json = JSON.stringify(toProjectExport(project), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitize(project.name)}.movie-desk.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const sanitize = (s: string): string =>
  s.replace(/[^a-z0-9_\-]+/gi, "_").slice(0, 60) || "untitled";
