import {
  parseCurrentProject,
  parseStoredProject,
  prepareStoredProject,
} from "@/persistence/project-io";
import { NestedTimelineError } from "@movie-desk/core";
import type { Clip, MediaAsset, MediaCollection, Project, Track } from "@movie-desk/core";
import * as Y from "yjs";
import {
  type RecoveryReason,
  reconcileSequence,
  recoverEntityOrder,
  uniqueSequence,
} from "./crdt-sequence";
import { createTimelineCrdt, timelineClipKey } from "./timeline-crdt";

const PROJECT_CRDT_SCHEMA_VERSION = 3;
export const MIGRATION_BACKUP_LIMIT = 1024 * 1024;

const CLIPS_MAP_NAME = "clips";

const META = "project-meta";
const META_SCHEMA = "schemaVersion";
const TRACKS = "tracks-v2";
const TRACK_ORDER = "track-order-v2";
const MEDIA = "media-v2";
const MEDIA_ORDER = "media-order-v2";
const COLLECTIONS = "collections-v1";
const COLLECTION_ORDER = "collection-order-v1";
const CLIP_ORDER_PREFIX = "track-clips-v2:";

type TrackMeta = Omit<Track, "clips">;

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const jsonEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const setJsonValue = (map: Y.Map<unknown>, key: string, value: unknown): void => {
  if (!jsonEqual(map.get(key), value)) map.set(key, jsonClone(value));
};

const syncEntityMap = <T>(map: Y.Map<T>, values: ReadonlyMap<string, T>): void => {
  for (const key of [...map.keys()]) {
    if (!values.has(key)) map.delete(key);
  }
  for (const [key, value] of values) {
    if (!jsonEqual(map.get(key), value)) map.set(key, jsonClone(value));
  }
};

export interface ProjectCrdt {
  readonly clips: Y.Map<Clip>;
  isInitialized(): boolean;
  takeRecovery(): boolean;
  takeRecoveryReasons(): RecoveryReason[];
  write(project: Project): void;
  read(projectId: Project["id"], localView: Project["timeline"]): Project | null;
}

export const createProjectCrdt = (doc: Y.Doc): ProjectCrdt => {
  const metaMap = doc.getMap<unknown>(META);
  const tracksMap = doc.getMap<TrackMeta>(TRACKS);
  const trackOrder = doc.getArray<string>(TRACK_ORDER);
  const mediaMap = doc.getMap<MediaAsset>(MEDIA);
  const mediaOrder = doc.getArray<string>(MEDIA_ORDER);
  // Per-collection entries, like media: two tabs creating different
  // collections must both keep theirs (a single JSON blob would be
  // last-write-wins).
  const collectionsMap = doc.getMap<MediaCollection>(COLLECTIONS);
  const collectionOrder = doc.getArray<string>(COLLECTION_ORDER);
  const clipsMap = doc.getMap<Clip>(CLIPS_MAP_NAME);
  const reasons = new Set<RecoveryReason>();
  const recovery = (reason: RecoveryReason) => {
    reasons.add(reason);
  };
  const timelines = createTimelineCrdt(doc, recovery);
  const clipOrderFor = (trackId: string) => doc.getArray<string>(`${CLIP_ORDER_PREFIX}${trackId}`);

  const write = (input: Project): void => {
    const project = prepareStoredProject(input);
    doc.transact(() => {
      timelines.write(project);
      setJsonValue(metaMap, "rootTimelineId", project.rootTimelineId);
      setJsonValue(metaMap, META_SCHEMA, PROJECT_CRDT_SCHEMA_VERSION);
      if (project.audio) setJsonValue(metaMap, "audio", project.audio);
      else metaMap.delete("audio");
      setJsonValue(metaMap, "name", project.name);
      setJsonValue(metaMap, "createdAt", project.createdAt);
      setJsonValue(metaMap, "framerate", project.framerate);
      setJsonValue(metaMap, "resolution", project.resolution);
      // Schema-compat shim: `magnetic` left the model (it never drove behavior)
      // but documents written by older builds require a boolean here.
      setJsonValue(metaMap, "magnetic", true);
      setJsonValue(metaMap, "markers", project.timeline.markers ?? []);
      const nextCollections = new Map((project.collections ?? []).map((c) => [c.id, c]));
      syncEntityMap(collectionsMap, nextCollections);
      reconcileSequence(
        collectionOrder,
        (project.collections ?? []).map((c) => c.id),
      );

      const nextMedia = new Map(project.mediaLibrary.map((asset) => [asset.id, asset]));
      syncEntityMap(mediaMap, nextMedia);
      reconcileSequence(
        mediaOrder,
        project.mediaLibrary.map((asset) => asset.id),
      );
    });
  };

  const read = (projectId: Project["id"], localView: Project["timeline"]): Project | null => {
    reasons.clear();
    const version = metaMap.get(META_SCHEMA);
    if (version === undefined) {
      if (metaMap.size || tracksMap.size || clipsMap.size || doc.getMap("timelines-v3").size)
        throw new NestedTimelineError(
          "Missing CRDT schema version; original document is unchanged",
        );
      return null;
    }
    if (version !== 2 && version !== PROJECT_CRDT_SCHEMA_VERSION)
      throw new NestedTimelineError("Unsupported CRDT schema; original document is unchanged");
    try {
      const nested =
        version === 3 ? timelines.read(metaMap.get("rootTimelineId"), localView) : null;

      const tracks: Track[] = [];
      const seenLegacyClips = new Set<string>();
      for (const trackId of nested
        ? []
        : recoverEntityOrder(trackOrder.toArray(), tracksMap, recovery)) {
        const track = tracksMap.get(trackId);
        if (!track || track.id !== trackId)
          throw new NestedTimelineError("Missing or mismatched legacy track");
        const clips = uniqueSequence(clipOrderFor(trackId).toArray()).flatMap((clipId) => {
          const clip = clipsMap.get(clipId);
          if (clip === undefined) {
            recovery("referencesRemoved");
            return [];
          }
          if (!clip || clip.id !== clipId)
            throw new NestedTimelineError("Missing or mismatched legacy clip");
          if (seenLegacyClips.has(clipId)) {
            recovery("referencesRemoved");
            return [];
          }
          seenLegacyClips.add(clipId);
          return clip;
        });
        tracks.push({ ...track, clips });
      }
      const legacyPlaced = new Set(tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
      const legacyOrphans = nested
        ? []
        : [...clipsMap].filter(([id]) => !legacyPlaced.has(id as Clip["id"]));
      if (legacyOrphans.length) recovery("clipsPreserved");
      const duration = tracks.reduce(
        (max, track) =>
          track.clips.reduce(
            (trackMax, clip) => Math.max(trackMax, clip.start + clip.duration),
            max,
          ),
        0,
      );
      const mediaIds = recoverEntityOrder(mediaOrder.toArray(), mediaMap, recovery);
      const collectionIds = recoverEntityOrder(collectionOrder.toArray(), collectionsMap, recovery);
      const mediaLibrary = mediaIds
        .map((assetId) => mediaMap.get(assetId))
        .filter((asset): asset is MediaAsset => asset !== undefined);

      // Retain map-only entities; the next edit persists their recovered order.
      const name = metaMap.get("name");
      const createdAt = metaMap.get("createdAt");
      const framerate = metaMap.get("framerate");
      const resolution = metaMap.get("resolution");
      const markers = metaMap.get("markers");
      // Optional: documents written before A3 have no collections.
      const collections = collectionIds
        .map((collectionId) => collectionsMap.get(collectionId))
        .filter((collection): collection is MediaCollection => collection !== undefined);
      if (
        mediaLibrary.length !== mediaIds.length ||
        collections.length !== collectionIds.length ||
        mediaLibrary.some((asset, i) => asset.id !== mediaIds[i]) ||
        collections.some((item, i) => item.id !== collectionIds[i])
      )
        throw new NestedTimelineError("Incomplete media or collection order");
      if (
        typeof name !== "string" ||
        typeof createdAt !== "number" ||
        typeof framerate !== "number" ||
        !resolution ||
        typeof resolution !== "object" ||
        !Array.isArray(markers)
      ) {
        throw new NestedTimelineError("Invalid CRDT project metadata");
      }

      const candidate = {
        id: projectId,
        ...(nested ? { preservedClips: timelines.preservedClips() } : {}),
        name,
        createdAt,
        updatedAt: Date.now(),
        framerate,
        resolution: resolution as Project["resolution"],
        mediaLibrary,
        ...(metaMap.has("audio") ? { audio: metaMap.get("audio") } : {}),
        ...(collections.length > 0 ? { collections } : {}),
        ...(nested ? { timelines: nested, rootTimelineId: metaMap.get("rootTimelineId") } : {}),
        timeline: nested
          ? nested.find((timeline) => timeline.id === metaMap.get("rootTimelineId"))
          : {
              tracks,
              playhead: localView.playhead,
              zoom: localView.zoom,
              duration,
              markers: markers as NonNullable<Project["timeline"]["markers"]>,
            },
      };
      if (nested) return parseCurrentProject(candidate);
      const parsedLegacy = parseStoredProject(candidate);
      const project = parseCurrentProject({
        ...parsedLegacy,
        preservedClips: legacyOrphans.map(([, clip]) => ({
          timelineId: parsedLegacy.rootTimelineId,
          clip,
        })),
      });
      // Yjs transactions do not roll back exceptions. Stage and fully validate on
      // an isolated document, then apply one update to the original.
      const backup = Y.encodeStateAsUpdate(doc);
      const staged = new Y.Doc();
      try {
        Y.applyUpdate(staged, backup);
        const next = createProjectCrdt(staged);
        next.write(project);
        for (const [id, clip] of legacyOrphans) {
          if (!clip || clip.id !== id)
            throw new NestedTimelineError("Missing or mismatched legacy clip");
          next.clips.set(timelineClipKey(project.rootTimelineId, id), clip);
        }
        next.read(projectId, localView);
        if (backup.byteLength <= MIGRATION_BACKUP_LIMIT)
          staged.getMap("migration-backup-v2").set("update", backup);
        staged.getMap("migration-backup-v2").set("pendingCleanup", true);
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(staged, Y.encodeStateVector(doc)));
      } finally {
        staged.destroy();
      }
      return project;
    } catch (error) {
      reasons.clear();
      if (error instanceof NestedTimelineError) throw error;
      throw new NestedTimelineError(
        `Cannot open CRDT project; original data is unchanged: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return {
    clips: timelines.clips,
    takeRecovery: () => {
      const value = reasons.size > 0;
      reasons.clear();
      return value;
    },
    takeRecoveryReasons: () => {
      const value = [...reasons];
      reasons.clear();
      return value;
    },
    isInitialized: () =>
      metaMap.size > 0 || tracksMap.size > 0 || doc.getMap("timelines-v3").size > 0,
    write,
    read,
  };
};

// Called only after a schema-3 IndexedDB transaction commits. Deleting these
// values also lets Yjs GC release large inline previews during compaction.
export const discardMigrationBackup = (doc: Y.Doc): void => {
  if (doc.getMap("project-meta").get("schemaVersion") !== 3) return;
  doc.transact(() => {
    doc.getMap("migration-backup-v2").clear();
    doc.getMap("tracks-v2").clear();
    doc.getArray("track-order-v2").delete(0, doc.getArray("track-order-v2").length);
    doc.getMap("clips").clear();
    doc.getMap("project").clear();
    doc.getMap("structure").clear();
    for (const [name] of doc.share) {
      if (!name.startsWith(CLIP_ORDER_PREFIX)) continue;
      const order = doc.getArray(name);
      order.delete(0, order.length);
    }
  });
};
