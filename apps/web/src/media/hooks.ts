"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useProjectStore } from "@/stores/project-store";
import { t } from "@/i18n/use-t";
import { importMediaFile } from "./import";
import { useImportProgressStore } from "./import-progress-store";
import { DesktopHeicImportError, importDesktopHeicFile, isHeicFile } from "./desktop-heic-import";

export interface ImportState {
  importing: boolean;
  importFiles: (files: FileList | File[]) => Promise<void>;
}

export const useMediaImport = (): ImportState => {
  const [importing, setImporting] = useState(false);
  const addMediaAsset = useProjectStore((s) => s.addMediaAsset);

  const importFiles = useCallback(
    async (input: FileList | File[]) => {
      const files = Array.from(input);
      if (files.length === 0) return;
      const progress = useImportProgressStore.getState();
      if (progress.active) {
        toast.info(t("media.importBusy"));
        return;
      }
      setImporting(true);
      progress.start(files.length);
      let done = 0;
      let failed = 0;
      let desktopRequired = 0;
      let cancelled = false;
      try {
        for (const file of files) {
          if (useImportProgressStore.getState().cancelRequested) {
            cancelled = true;
            break;
          }
          useImportProgressStore.getState().beginFile(file.name);
          try {
            // process serially to keep memory bounded
            if (isHeicFile(file)) {
              const asset = await importDesktopHeicFile(file);
              const alreadyImported = useProjectStore
                .getState()
                .project.mediaLibrary.some((candidate) => candidate.id === asset.id);
              if (!alreadyImported) addMediaAsset(asset);
            } else {
              const { asset, releaseLease } = await importMediaFile(file);
              try {
                addMediaAsset(asset);
              } finally {
                releaseLease();
              }
            }
            done++;
            useImportProgressStore.getState().fileDone();
          } catch (error) {
            // One bad file must not abort the whole batch.
            failed++;
            if (error instanceof DesktopHeicImportError && error.code === "DESKTOP_REQUIRED") {
              desktopRequired++;
            }
            useImportProgressStore.getState().fileFailed();
          }
        }
        const skipped = files.length - done - failed;
        if (cancelled) {
          toast.info(t("media.importCancelled", { done, skipped }));
        } else if (desktopRequired === failed && failed > 0) {
          toast.warning(t("media.heicDesktopOnly", { n: failed }));
        } else if (failed > 0) {
          toast.warning(t("media.importedPartial", { done, failed }));
        } else {
          toast.success(t("media.imported", { n: done }));
        }
      } finally {
        useImportProgressStore.getState().finish();
        setImporting(false);
      }
    },
    [addMediaAsset],
  );

  return { importing, importFiles };
};
