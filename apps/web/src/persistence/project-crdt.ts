import { parseStoredProject } from "@/persistence/project-export";
import type { Clip, MediaAsset, MediaCollection, Project, Track } from "@movie-desk/core";
import type * as Y from "yjs";
import { reconcileSequence, uniqueSequence } from "./crdt-sequence";

const PROJECT_CRDT_SCHEMA_VERSION = 2;
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
  const clipOrderFor = (trackId: string) => doc.getArray<string>(`${CLIP_ORDER_PREFIX}${trackId}`);

  const write = (project: Project): void => {
    setJsonValue(metaMap, META_SCHEMA, PROJECT_CRDT_SCHEMA_VERSION);
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

    const nextTracks = new Map<string, TrackMeta>();
    const nextClips = new Map<string, Clip>();
    for (const track of project.timeline.tracks) {
      const { clips, ...trackMeta } = track;
      nextTracks.set(track.id, trackMeta);
      reconcileSequence(
        clipOrderFor(track.id),
        clips.map((clip) => clip.id),
      );
      for (const clip of clips) nextClips.set(clip.id, clip);
    }

    for (const trackId of tracksMap.keys()) {
      if (!nextTracks.has(trackId)) reconcileSequence(clipOrderFor(trackId), []);
    }
    syncEntityMap(tracksMap, nextTracks);
    reconcileSequence(
      trackOrder,
      project.timeline.tracks.map((track) => track.id),
    );
    syncEntityMap(clipsMap, nextClips);
  };

  const read = (projectId: Project["id"], localView: Project["timeline"]): Project | null => {
    if (metaMap.get(META_SCHEMA) !== PROJECT_CRDT_SCHEMA_VERSION) return null;

    const tracks: Track[] = [];
    for (const trackId of uniqueSequence(trackOrder.toArray())) {
      const track = tracksMap.get(trackId);
      if (!track) continue;
      const clips = uniqueSequence(clipOrderFor(trackId).toArray())
        .map((clipId) => clipsMap.get(clipId))
        .filter((clip): clip is Clip => clip !== undefined);
      tracks.push({ ...track, clips });
    }
    const duration = tracks.reduce(
      (max, track) =>
        track.clips.reduce((trackMax, clip) => Math.max(trackMax, clip.start + clip.duration), max),
      0,
    );
    const mediaLibrary = uniqueSequence(mediaOrder.toArray())
      .map((assetId) => mediaMap.get(assetId))
      .filter((asset): asset is MediaAsset => asset !== undefined);

    const name = metaMap.get("name");
    const createdAt = metaMap.get("createdAt");
    const framerate = metaMap.get("framerate");
    const resolution = metaMap.get("resolution");
    const markers = metaMap.get("markers");
    // Optional: documents written before A3 have no collections.
    const collections = uniqueSequence(collectionOrder.toArray())
      .map((collectionId) => collectionsMap.get(collectionId))
      .filter((collection): collection is MediaCollection => collection !== undefined);
    if (
      typeof name !== "string" ||
      typeof createdAt !== "number" ||
      typeof framerate !== "number" ||
      !resolution ||
      typeof resolution !== "object" ||
      !Array.isArray(markers)
    ) {
      return null;
    }

    const candidate = {
      id: projectId,
      name,
      createdAt,
      updatedAt: Date.now(),
      framerate,
      resolution: resolution as Project["resolution"],
      mediaLibrary,
      ...(collections.length > 0 ? { collections } : {}),
      timeline: {
        tracks,
        playhead: localView.playhead,
        zoom: localView.zoom,
        duration,
        markers: markers as NonNullable<Project["timeline"]["markers"]>,
      },
    };
    try {
      // Yjs values are read back from IndexedDB and do not retain their
      // TypeScript types at runtime. Reuse the persistence boundary schema
      // before any stored state reaches the renderer or project store.
      return parseStoredProject(candidate);
    } catch {
      return null;
    }
  };

  return {
    clips: clipsMap,
    isInitialized: () => metaMap.get(META_SCHEMA) === PROJECT_CRDT_SCHEMA_VERSION,
    write,
    read,
  };
};
