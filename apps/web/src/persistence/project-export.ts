import type { Project } from "@movie-desk/core";
import {
  NestedTimelineError,
  PROJECT_VERSION,
  hydrateProjectTimelines,
  isSafeRelativePath,
  syncRootTimeline,
} from "@movie-desk/core";
import { z } from "zod";
import { rememberRestoredProject } from "./hydration-state";

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
      preservePitch: z.boolean().optional(),
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
  z
    .object({
      ...clipBase,
      kind: z.literal("sequence"),
      timelineId: z.string().min(1),
      trimIn: nonNegative,
      trimOut: nonNegative,
      volume: nonNegative.optional(),
    })
    .passthrough(),
]);

const gainDbSchema = finite.min(-60).max(12);
const projectAudioSchema = z
  .object({
    buses: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().min(1).max(100),
            gainDb: gainDbSchema,
            muted: z.boolean().optional(),
          })
          .passthrough(),
      )
      .refine((buses) => new Set(buses.map((bus) => bus.id)).size === buses.length, {
        message: "Duplicate audio bus ID",
      }),
    master: z.object({ gainDb: gainDbSchema }).passthrough(),
  })
  .passthrough();

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
    audio: z
      .object({
        gainDb: gainDbSchema.optional(),
        pan: finite.min(-1).max(1).optional(),
        busId: z.string().min(1).optional(),
      })
      .passthrough()
      .optional()
      .catch(undefined),
    clips: z.array(clipSchema),
  })
  .passthrough()
  .transform(({ audio, ...rest }) => (audio === undefined ? rest : { ...rest, audio }));

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

export const mediaAssetSchema = z
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
    tags: z.array(z.string()).optional(),
    // A malformed mark is dropped, never a reason to refuse the project.
    rating: z.number().int().min(1).max(5).optional().catch(undefined),
    favorite: z.boolean().optional(),
    hasAudio: z.boolean().optional(),
  })
  .passthrough()
  // `.catch(undefined)` leaves the key behind; a dropped mark must not
  // linger as `rating: undefined` (record identity checks use `in`).
  .transform(({ rating, ...rest }) => (rating === undefined ? rest : { rating, ...rest }));

// Collections must never make a project unloadable: a kind this build does
// not know (a newer build wrote it) or an odd filter value passes through
// untouched so the next save keeps it. Smart filter values are validated
// field by field when the collection is loaded (media/smart-filters.ts).
const knownCollectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().min(1),
      name: z.string(),
      kind: z.literal("manual"),
      assetIds: z.array(z.string()),
    })
    .passthrough(),
  z
    .object({
      id: z.string().min(1),
      name: z.string(),
      kind: z.literal("smart"),
      query: z.string(),
      filters: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
]);
const unknownCollectionSchema = z
  .object({ id: z.string().min(1), name: z.string(), kind: z.string() })
  .passthrough();
const collectionSchema = z.union([knownCollectionSchema, unknownCollectionSchema]);

const markerSchema = z
  .object({
    id: z.string().min(1),
    at: nonNegative,
    endMs: nonNegative.optional(),
    label: z.string(),
    color: z.string().min(1),
  })
  .passthrough();

const timelineSchema = z
  .object({
    id: z.string().min(1),
    tracks: z.array(trackSchema),
    playhead: nonNegative,
    zoom: positive,
    duration: nonNegative,
    markers: z.array(markerSchema).optional(),
    magnetic: z.boolean().optional(),
  })
  .passthrough()
  .transform(({ magnetic: _legacy, ...rest }) => rest);

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
        // Legacy field accepted on input and stripped from the runtime model.
        magnetic: z.boolean().optional(),
        duration: nonNegative,
        markers: z.array(markerSchema).optional(),
      })
      .passthrough()
      .transform(({ magnetic: _legacy, ...rest }) => rest),
    mediaLibrary: z.array(mediaAssetSchema),
    collections: z.array(collectionSchema).optional(),
    audio: projectAudioSchema.optional().catch(undefined),
  })
  .passthrough()
  .transform(({ audio, ...rest }) =>
    audio === undefined ? rest : { ...rest, audio },
  ) as unknown as z.ZodType<Project>;

// Current-wire parser is deliberately distinct from legacy shape inference.
// CRDT schema 3 must use this entrypoint: omitting both new fields in its
// candidate must fail, even if the remaining object resembles a v1 project.
const currentProjectSchema = z
  .object({
    timelines: z.array(timelineSchema).nonempty(),
    rootTimelineId: z.string().min(1),
  })
  .passthrough();

const sameJson = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  );
};

export const parseCurrentProject = (raw: unknown): Project => {
  try {
    const nested = currentProjectSchema.parse(raw);
    const parsed = projectSchema.parse(nested);
    const timelines = nested.timelines as unknown as Project["timelines"];
    const ids = new Set(timelines.map((timeline) => timeline.id));
    if (ids.size !== timelines.length) throw new Error("Duplicate timeline ID");
    for (const timeline of timelines) {
      if (new Set(timeline.tracks.map((track) => track.id)).size !== timeline.tracks.length)
        throw new Error(`Duplicate track ID in timeline ${timeline.id}`);
      const clips = timeline.tracks.flatMap((track) => track.clips);
      if (new Set(clips.map((clip) => clip.id)).size !== clips.length)
        throw new Error(`Duplicate clip ID in timeline ${timeline.id}`);
    }
    const root = timelines.find((timeline) => timeline.id === nested.rootTimelineId);
    if (!root) throw new Error("Missing root timeline");
    if (!sameJson(parsed.timeline, root))
      throw new Error("Root timeline alias disagrees with timelines");
    return rememberRestoredProject(
      rememberAudioRecovery(raw, { ...parsed, timelines, rootTimelineId: root.id, timeline: root }),
    );
  } catch (error) {
    throw new NestedTimelineError(
      `Cannot open nested project; original data is unchanged: ${error instanceof z.ZodError ? "Some required project fields are missing or invalid" : error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const exportSchema = z.object({
  schema: z.literal("cut_editor-project"),
  version: z.number().int(),
  exportedAt: z.number().int(),
  project: z.unknown(),
});

// Recovery metadata is session-only: it never enters JSON, Yjs or the project model.
const recoveredAudio = new WeakSet<Project>();
const rememberAudioRecovery = (raw: unknown, project: Project): Project => {
  // Called only after the load-bearing project shape has passed validation.
  const input = raw as Project;
  if (
    (input.audio !== undefined && project.audio === undefined) ||
    (input.timelines ?? [input.timeline]).some((timeline, index) =>
      timeline.tracks.some(
        (track, i) =>
          track.audio !== undefined && project.timelines[index]?.tracks[i]?.audio === undefined,
      ),
    )
  )
    recoveredAudio.add(project);
  return project;
};
export const takeAudioRecovery = (project: Project): boolean => recoveredAudio.delete(project);
export const parseStoredProject = (raw: unknown): Project => {
  if (raw && typeof raw === "object" && ("timelines" in raw || "rootTimelineId" in raw))
    return parseCurrentProject(raw);
  const result = projectSchema.safeParse(raw);
  if (!result.success)
    throw new Error(
      "Cannot open project: some required fields are missing or invalid; original data is unchanged",
    );
  const legacy = result.data;
  return rememberAudioRecovery(raw, parseCurrentProject(hydrateProjectTimelines(legacy)));
};

export const prepareStoredProject = (project: Project): Project =>
  parseCurrentProject(syncRootTimeline(project));

export const toProjectExport = (project: Project): ProjectExport => ({
  schema: "cut_editor-project",
  version: PROJECT_VERSION,
  exportedAt: Date.now(),
  // Normalize legacy root-alias writers, then validate every timeline before saving.
  project: prepareStoredProject(project),
});

// Machine-readable rejection; project-menu translates direction and versions.
export class ProjectVersionError extends Error {
  constructor(
    readonly direction: "older" | "newer",
    readonly fileVersion: number,
    readonly appVersion: number,
  ) {
    super(`PROJECT_VERSION_${direction.toUpperCase()}:file=${fileVersion}:app=${appVersion}`);
    this.name = "ProjectVersionError";
  }
}

export const parseProjectExport = (raw: unknown): ProjectExport => {
  const env = exportSchema.parse(raw);
  // Refuse a file written by a newer app version rather than silently importing
  // a format we do not understand. Version 1 uses read-only shape migration.
  if (env.version !== 1 && env.version !== PROJECT_VERSION) {
    throw new ProjectVersionError(
      env.version < PROJECT_VERSION ? "older" : "newer",
      env.version,
      PROJECT_VERSION,
    );
  }
  return {
    ...env,
    project: env.version === 1 ? parseStoredProject(env.project) : parseCurrentProject(env.project),
  };
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
