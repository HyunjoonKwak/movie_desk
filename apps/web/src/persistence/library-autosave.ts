import type { Project } from "@movie-desk/core";
import { toast } from "sonner";
import { t } from "@/i18n/use-t";
import { useProjectStore } from "@/stores/project-store";
import { upsertProject } from "./project-library";
import { useSaveStateStore } from "./save-state-store";

// Both the debounce and cleanup flush handle failures, and later edits retry.
export const startLibraryAutosave = (): (() => void) => {
  const persist = async (project: Project): Promise<void> => {
    try {
      await upsertProject(project);
      useSaveStateStore.getState().setLibraryError(false);
    } catch {
      useSaveStateStore.getState().setLibraryError(true);
      toast.error(t("project.saveFailed"), { id: "library-save-failed" });
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
      // Playhead, zoom, duration, and updatedAt are local/derived state. All
      // editable shared content is covered by these referential boundaries.
      const contentChanged =
        project.id !== previous.id ||
        project.name !== previous.name ||
        project.createdAt !== previous.createdAt ||
        project.framerate !== previous.framerate ||
        project.resolution !== previous.resolution ||
        project.mediaLibrary !== previous.mediaLibrary ||
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
