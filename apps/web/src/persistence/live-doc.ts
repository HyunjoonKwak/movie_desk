import { useProjectStore } from "@/stores/project-store";
import type { Clip, Project, Track } from "@cut/core";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { createProjectCrdt } from "./project-crdt";
import { useSaveStateStore } from "./save-state-store";

// The live document: the active project mirrored into a Yjs doc that
// y-indexeddb persists on every change, so edits survive reloads.

// Previous schemas retained only for one-time migration.
const LEGACY_STRUCT = "structure";
const LEGACY_STRUCT_KEY = "v";
const LEGACY_MAP = "project";
const LEGACY_KEY = "snapshot";

const LOCAL_ORIGIN = { local: true };

type TrackMeta = Omit<Track, "clips">;
type LegacyStructure = Omit<Project, "id" | "timeline"> & {
  timeline: Omit<Project["timeline"], "tracks"> & {
    tracks: (TrackMeta & { clipIds: readonly string[] })[];
  };
};

const legacyProject = (
  projectId: Project["id"],
  structure: LegacyStructure,
  clipsMap: Y.Map<Clip>,
  localView: Project["timeline"],
): Project => {
  const tracks = structure.timeline.tracks.map(({ clipIds, ...track }) => ({
    ...track,
    clips: clipIds.map((id) => clipsMap.get(id)).filter((clip): clip is Clip => clip !== undefined),
  }));
  const duration = tracks.reduce(
    (max, track) =>
      track.clips.reduce((trackMax, clip) => Math.max(trackMax, clip.start + clip.duration), max),
    0,
  );
  return {
    ...structure,
    id: projectId,
    timeline: {
      ...structure.timeline,
      tracks,
      duration,
      playhead: localView.playhead,
      zoom: localView.zoom,
    },
  };
};

export interface LiveDoc {
  readonly projectId: Project["id"];
  dispose: () => void;
}

let live: LiveDoc | null = null;

// Kept as-is across the rename so existing browsers keep opening their projects.
export const projectPersistenceName = (projectId: Project["id"]): string =>
  `cut-editor:project:${encodeURIComponent(projectId)}`;

export const getLiveDoc = (): LiveDoc => {
  const projectId = useProjectStore.getState().project.id;
  if (live?.projectId === projectId) return live;
  live?.dispose();

  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(projectPersistenceName(projectId), doc);
  const projectCrdt = createProjectCrdt(doc);
  const clipsMap = projectCrdt.clips;

  let applyingFromDoc = false;
  let disposed = false;

  const flush = (): void => {
    const project = useProjectStore.getState().project;
    if (disposed || project.id !== projectId) return;
    doc.transact(() => projectCrdt.write(project), LOCAL_ORIGIN);
    queueMicrotask(() => useSaveStateStore.getState().markSaved());
  };

  // Loads the stored document into the store. Runs when IndexedDB finishes
  // restoring; those transactions carry the provider's origin, not ours.
  // loadProject resets undo history, which is what a fresh open wants.
  const applyFromDoc = (): Project | null => {
    if (disposed) return null;
    const localProject = useProjectStore.getState().project;
    if (localProject.id !== projectId) return null;
    const project = projectCrdt.read(projectId, localProject.timeline);
    if (!project) return null;
    applyingFromDoc = true;
    try {
      useProjectStore.getState().loadProject(project);
      doc.transact(() => projectCrdt.write(project), LOCAL_ORIGIN);
    } finally {
      applyingFromDoc = false;
    }
    return project;
  };

  // Content mutations flush synchronously; native Yjs operations are cheap.
  const unsubscribe = useProjectStore.subscribe(
    (state) => state.project,
    (project, previous) => {
      if (applyingFromDoc || project.id !== projectId) return;
      if (
        project.timeline.tracks === previous.timeline.tracks &&
        project.mediaLibrary === previous.mediaLibrary &&
        project.name === previous.name &&
        project.framerate === previous.framerate &&
        project.resolution === previous.resolution &&
        project.timeline.markers === previous.timeline.markers
      ) {
        return;
      }
      useSaveStateStore.getState().setState("saving");
      flush();
    },
  );

  const afterTransaction = (transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL_ORIGIN || disposed) return;
    applyFromDoc();
  };
  doc.on("afterTransaction", afterTransaction);
  persistence.on("synced", () => useSaveStateStore.getState().markSaved());

  void persistence.whenSynced.then(() => {
    if (disposed) return;
    if (projectCrdt.isInitialized()) {
      applyFromDoc();
      return;
    }

    const current = useProjectStore.getState().project;
    const oldSnapshot = doc.getMap<Project>(LEGACY_MAP).get(LEGACY_KEY);
    const oldStructure = doc.getMap<LegacyStructure>(LEGACY_STRUCT).get(LEGACY_STRUCT_KEY);
    const seed = oldSnapshot
      ? { ...oldSnapshot, id: projectId }
      : oldStructure
        ? legacyProject(projectId, oldStructure, clipsMap, current.timeline)
        : current;

    doc.transact(() => {
      projectCrdt.write(seed);
      doc.getMap<Project>(LEGACY_MAP).delete(LEGACY_KEY);
      doc.getMap<LegacyStructure>(LEGACY_STRUCT).delete(LEGACY_STRUCT_KEY);
    }, LOCAL_ORIGIN);
    applyFromDoc();
  });

  live = {
    projectId,
    dispose: () => {
      if (disposed) return;
      unsubscribe();
      disposed = true;
      doc.off("afterTransaction", afterTransaction);
      persistence.destroy();
      doc.destroy();
      live = null;
    },
  };
  return live;
};

export const disposeLiveDoc = (): void => {
  live?.dispose();
};
