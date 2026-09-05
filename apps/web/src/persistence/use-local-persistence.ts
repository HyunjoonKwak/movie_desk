"use client";

import { t } from "@/i18n/use-t";
import { usePreviewStore } from "@/stores/preview-store";
import { useProjectStore } from "@/stores/project-store";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { disposeLiveDoc, getLiveDoc } from "./live-doc";
import { startInlinePreviewMigration } from "./previews";
import { getActiveProjectId, loadStoredProject } from "./project-library";

let started = false;
const WELCOME_KEY = "cut.persistence.welcomed";

// Mount once at the editor root. Restores the active project from the library,
// then opens its live document so edits persist to IndexedDB. Returns true
// once the project is ready to edit.
export const useLocalPersistence = (): boolean => {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (started) return;
    started = true;
    let cancelled = false;
    let unsubscribeProject: (() => void) | null = null;
    let stopMigration: (() => void) | null = null;

    const initialize = async () => {
      try {
        const activeId = await getActiveProjectId();
        const activeResult = activeId ? await loadStoredProject(activeId) : null;
        if (cancelled) return;
        if (activeResult?.status === "ok") {
          useProjectStore.getState().loadProject(activeResult.project);
        } else if (activeResult?.status === "corrupt") {
          toast.error(t("project.activeCorrupt"));
        }

        getLiveDoc();
        // Records written by older builds carry inline thumbnails; move
        // them to the preview store as they show up.
        stopMigration = startInlinePreviewMigration(useProjectStore);
        unsubscribeProject = useProjectStore.subscribe(
          (state) => state.project.id,
          () => {
            usePreviewStore.getState().clear();
            // getLiveDoc disposes the previous project's document and opens
            // the correctly namespaced one for the new active id.
            try {
              getLiveDoc();
            } catch {
              toast.error(t("persistence.openFailed"));
            }
          },
        );

        // No noisy toast on every reload — only the first time.
        if (!localStorage.getItem(WELCOME_KEY)) {
          toast.success(t("persistence.welcome"));
          localStorage.setItem(WELCOME_KEY, "1");
        }
      } catch {
        // Persistence failure should not make the editor unusable.
        toast.error(t("persistence.unavailable"));
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };

    void initialize();
    return () => {
      cancelled = true;
      unsubscribeProject?.();
      stopMigration?.();
      disposeLiveDoc();
      setHydrated(false);
      started = false;
    };
  }, []);

  return hydrated;
};
