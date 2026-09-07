import { t } from "@/i18n/use-t";
import { reloadSpan } from "@/lib/reload-metrics";
import { useProjectStore } from "@/stores/project-store";
import { type LegacyProject, NestedTimelineError } from "@movie-desk/core";
import type { Clip, Project, Track } from "@movie-desk/core";
import { toast } from "sonner";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { installCheckedWriter } from "./checked-indexeddb";
import { allowProjectWrites, blockProjectWrites, isRestoredMaintenance } from "./hydration-state";
import { createProjectCrdt, discardMigrationBackup } from "./project-crdt";
import { parseStoredProject } from "./project-io";
import { insertRecoveredProject } from "./project-library";
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
type LegacyStructure = Omit<LegacyProject, "id" | "timeline"> & {
  timeline: Omit<LegacyProject["timeline"], "tracks"> & {
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
    clips: clipIds.map((id) => {
      const clip = clipsMap.get(id);
      if (!clip || clip.id !== id)
        throw new NestedTimelineError("Missing legacy clip; original document is unchanged");
      return clip;
    }),
  }));
  const duration = tracks.reduce(
    (max, track) =>
      track.clips.reduce((trackMax, clip) => Math.max(trackMax, clip.start + clip.duration), max),
    0,
  );
  return parseStoredProject({
    ...structure,
    id: projectId,
    timeline: {
      ...structure.timeline,
      tracks,
      duration,
      playhead: localView.playhead,
      zoom: localView.zoom,
    },
  });
};

export interface LiveDoc {
  readonly projectId: Project["id"];
  dispose: () => void;
}

let live: LiveDoc | null = null;

// Legacy storage namespace retained so existing browsers keep opening their projects.
export const projectPersistenceName = (projectId: Project["id"]): string =>
  `cut-editor:project:${encodeURIComponent(projectId)}`;

export const getLiveDoc = (options: { recoverMissingLibrary?: boolean } = {}): LiveDoc => {
  const projectId = useProjectStore.getState().project.id;
  if (live?.projectId === projectId) return live;
  live?.dispose();

  const loaded = reloadSpan("yjs-load");
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(projectPersistenceName(projectId), doc);
  const projectCrdt = createProjectCrdt(doc);
  const clipsMap = doc.getMap<Clip>("clips");
  blockProjectWrites(projectId);
  useSaveStateStore.getState().setDocumentError(false);

  let applyingFromDoc = false;
  let disposed = false;
  let restored = false;
  let failed = false;
  const fail = (error: unknown): void => {
    if (disposed) return;
    failed = true;
    blockProjectWrites(projectId);
    useSaveStateStore.getState().setDocumentError(true);
    toast.error(
      `${t("persistence.openFailed")}: ${error instanceof Error ? error.message : String(error)}`,
      { id: `hydrate-failed:${projectId}` },
    );
  };

  let invalidEdit = false;
  const saveFailed = (_error: unknown): void => {
    if (disposed) return;
    useSaveStateStore.getState().setDocumentError(true);
    toast.error(t("project.saveFailed"), { id: `document-save-failed:${projectId}` });
  };
  const saved = (): void => {
    if (disposed || failed || invalidEdit) return;
    useSaveStateStore.getState().setDocumentError(false);
    useSaveStateStore.getState().markSaved();
  };
  const checkpoint = installCheckedWriter(persistence, {
    saved,
    failed: saveFailed,
    cleanup: () => {
      if (!disposed) doc.transact(() => discardMigrationBackup(doc), LOCAL_ORIGIN);
    },
  });

  const flush = (): void => {
    const project = useProjectStore.getState().project;
    if (disposed || !restored || failed || project.id !== projectId) return;
    try {
      const retry = useSaveStateStore.getState().documentError;
      doc.transact(() => projectCrdt.write(project), LOCAL_ORIGIN);
      invalidEdit = false;
      if (retry) checkpoint();
    } catch (error) {
      // Temporary invalid edit states must not escape the store subscription.
      // Leave hydration usable: the next valid edit retries the save.
      invalidEdit = true;
      saveFailed(error);
    }
  };

  // Loads the stored document into the store. Runs when IndexedDB finishes
  // restoring; those transactions carry the provider's origin, not ours.
  // loadProject resets undo history, which is what a fresh open wants.
  const applyFromDoc = (): Project | null => {
    if (disposed) return null;
    const localProject = useProjectStore.getState().project;
    if (localProject.id !== projectId) return null;
    const readEnd = reloadSpan("yjs-read-validate");
    let project: Project | null;
    applyingFromDoc = true;
    try {
      project = projectCrdt.read(projectId, localProject.timeline);
    } catch (error) {
      fail(error);
      return null;
    } finally {
      applyingFromDoc = false;
      readEnd();
    }
    if (!project) return null;
    const end = reloadSpan("applyFromDoc");
    applyingFromDoc = true;
    try {
      useProjectStore.getState().loadProject(project);
    } finally {
      applyingFromDoc = false;
      end();
    }
    return project;
  };

  // Live precision frames update the renderer, but flush once when the session ends.
  const unsubscribe = useProjectStore.subscribe(
    (state) => ({ project: state.project, editing: state.precisionEditing }),
    ({ project, editing }, old) => {
      const previous = old.project;
      if (applyingFromDoc || failed || isRestoredMaintenance(project) || project.id !== projectId)
        return;
      if (
        project.timelines === previous.timelines &&
        project.rootTimelineId === previous.rootTimelineId &&
        project.timeline.tracks === previous.timeline.tracks &&
        project.mediaLibrary === previous.mediaLibrary &&
        project.collections === previous.collections &&
        project.audio === previous.audio &&
        project.name === previous.name &&
        project.framerate === previous.framerate &&
        project.resolution === previous.resolution &&
        project.timeline.markers === previous.timeline.markers &&
        !(old.editing && !editing)
      ) {
        return;
      }
      useSaveStateStore.getState().setState("saving");
      if (!editing) flush();
    },
    { equalityFn: (a, b) => a.project === b.project && a.editing === b.editing },
  );

  // Startup may replay several updates; whenSynced applies their final state once.
  // Read-only Yjs transactions must not reset history or rebuild the media list.
  const afterTransaction = (transaction: Y.Transaction) => {
    if (
      transaction.origin === LOCAL_ORIGIN ||
      disposed ||
      !restored ||
      failed ||
      applyingFromDoc ||
      transaction.changed.size === 0
    )
      return;
    applyFromDoc();
  };
  doc.on("afterTransaction", afterTransaction);
  persistence.on("synced", () => {
    if (restored && !failed) useSaveStateStore.getState().markSaved();
  });

  const recoverLibrary = async (project: Project | null): Promise<void> => {
    if (failed || !project || !options.recoverMissingLibrary) return;
    try {
      await insertRecoveredProject(project);
    } catch {
      if (disposed) return;
      useSaveStateStore.getState().setLibraryError(true);
      toast.error(t("project.saveFailed"), { id: "library-save-failed" });
    }
  };

  const restore = async (): Promise<void> => {
    try {
      await persistence.whenSynced;
      loaded();
      if (disposed) return;
      restored = true;
      if (projectCrdt.isInitialized()) {
        const recovered = applyFromDoc();
        if (!failed) allowProjectWrites(projectId);
        // Also checkpoint an already-migrated document whose previous session
        // ended between committing v3 and discarding recovery data.
        if (!failed && doc.getMap("migration-backup-v2").size) checkpoint();
        await recoverLibrary(recovered);
        return;
      }

      const current = useProjectStore.getState().project;
      const oldSnapshot = doc.getMap<LegacyProject>(LEGACY_MAP).get(LEGACY_KEY);
      const oldStructure = doc.getMap<LegacyStructure>(LEGACY_STRUCT).get(LEGACY_STRUCT_KEY);
      const seed = oldSnapshot
        ? parseStoredProject({ ...oldSnapshot, id: projectId })
        : oldStructure
          ? legacyProject(projectId, oldStructure, clipsMap, current.timeline)
          : current;

      doc.transact(() => {
        projectCrdt.write(seed);
        // Retain legacy roots as recovery evidence.
      }, LOCAL_ORIGIN);
      const recovered = oldSnapshot || oldStructure ? applyFromDoc() : seed;
      if (!failed) allowProjectWrites(projectId);
      await recoverLibrary(recovered);
    } catch (error) {
      fail(error);
    }
  };
  void restore();

  live = {
    projectId,
    dispose: () => {
      if (disposed) return;
      if (
        useProjectStore.getState().project.id === projectId &&
        useProjectStore.getState().precisionEditing
      ) {
        useProjectStore.getState().endPrecisionEdit();
      }
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
