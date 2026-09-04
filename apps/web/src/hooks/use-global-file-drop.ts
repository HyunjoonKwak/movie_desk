"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useMediaImport } from "@/media/hooks";
import { collectDroppedMediaFiles } from "@/media/folder-import";
import { useImportFailureStore } from "@/media/import-failure-store";
import { useProjectStore } from "@/stores/project-store";
import { t } from "@/i18n/use-t";

// Window-level drag-and-drop guard. Without it, dropping a file outside a
// dedicated drop zone navigates the window to file:// — in the Electron
// shell that blanks the whole editor. Media files dropped anywhere are
// routed into the import pipeline; everything else is swallowed. Directory
// entries are recursively expanded so a camera DCIM folder behaves like the
// same files selected individually.

export const useGlobalFileDrop = (onImportHandled?: () => void): void => {
  const { importFiles } = useMediaImport();

  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = async (e: DragEvent) => {
      // A dedicated drop zone (e.g. the media bin) already handled this one.
      if (e.defaultPrevented) return;
      e.preventDefault();
      if (!e.dataTransfer) return;
      const collected = await collectDroppedMediaFiles(e.dataTransfer);
      if (collected.unreadablePaths.length > 0) {
        toast.warning(t("media.folderUnreadable", { n: collected.unreadablePaths.length }));
      }
      if (collected.candidates.length === 0) return;
      const mediaBefore = useProjectStore.getState().project.mediaLibrary.length;
      const failuresBefore = useImportFailureStore.getState().failures.length;
      await importFiles(collected.candidates);
      const mediaAfter = useProjectStore.getState().project.mediaLibrary.length;
      const failuresAfter = useImportFailureStore.getState().failures.length;
      if (mediaAfter > mediaBefore || failuresAfter > failuresBefore) onImportHandled?.();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [importFiles, onImportHandled]);
};
