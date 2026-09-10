import { t } from "@/i18n/use-t";
import { useProjectStore } from "@/stores/project-store";
import type { Project } from "@movie-desk/core";
import { toast } from "sonner";
import { upsertProject } from "./project-library";
import { useSaveStateStore } from "./save-state-store";

import { isRestoredProject, projectWritesBlocked } from "./hydration-state";

let latestWrite = 0;

// Both the debounce and cleanup flush handle failures, and later edits retry.
export const startLibraryAutosave = (): (() => void) => {
  const persist = async (project: Project): Promise<void> => {
    if (isRestoredProject(project) || projectWritesBlocked(project.id)) return;
    const write = ++latestWrite;
    try {
      await upsertProject(project);
      if (write !== latestWrite) return;
      useSaveStateStore.getState().setLibraryError(false);
    } catch (error) {
      if (write !== latestWrite) return;
      useSaveStateStore.getState().setLibraryError(true);
      // The reason is the only thing that makes this actionable; a bare
      // "save failed" once hid a schema rejection for days.
      toast.error(t("project.saveFailed"), {
        id: "library-save-failed",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued = useProjectStore.getState().project;
  const schedule = (project: Project) => {
    queued = project;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void persist(queued);
    }, 300);
  };
  schedule(queued);

  const unsubscribe = useProjectStore.subscribe(
    (state) => state.project,
    (project, previous) => {
      // Include the full timeline collection: inactive child edits do not
      // replace the root alias. updatedAt alone does not schedule a write.
      const contentChanged =
        project.id !== previous.id ||
        project.name !== previous.name ||
        project.createdAt !== previous.createdAt ||
        project.framerate !== previous.framerate ||
        project.resolution !== previous.resolution ||
        project.mediaLibrary !== previous.mediaLibrary ||
        project.collections !== previous.collections ||
        project.timelines !== previous.timelines ||
        project.rootTimelineId !== previous.rootTimelineId ||
        project.audio !== previous.audio ||
        project.timeline.tracks !== previous.timeline.tracks ||
        project.timeline.markers !== previous.timeline.markers;
      if (contentChanged) schedule(project);
    },
  );

  return () => {
    unsubscribe();
    if (timer) {
      clearTimeout(timer);
      void persist(queued);
    }
  };
};
