"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useProjectStore } from "@/stores/project-store";
import { t } from "@/i18n/use-t";
import { importMediaFile } from "./import";
import { runMediaImportBatch } from "./import-batch";
import { useImportProgressStore } from "./import-progress-store";
import { useImportFailureStore } from "./import-failure-store";
import { createMediaImportFailure } from "./import-errors";
import { DesktopHeicImportError, importDesktopHeicFile, isHeicFile } from "./desktop-heic-import";
import { type MediaImportCandidate, toMediaImportCandidate } from "./folder-import";

export type MediaImportInput = FileList | readonly File[] | readonly MediaImportCandidate[];

export interface ImportState {
  importing: boolean;
  importFiles: (files: MediaImportInput) => Promise<void>;
}

const normalizeCandidates = (input: MediaImportInput): readonly MediaImportCandidate[] =>
  Array.from(input as ArrayLike<File | MediaImportCandidate>).map((value) =>
    "file" in value ? value : toMediaImportCandidate(value),
  );

export const useMediaImport = (): ImportState => {
  const [importing, setImporting] = useState(false);
  const addMediaAsset = useProjectStore((s) => s.addMediaAsset);

  const importFiles = useCallback(
    async (input: MediaImportInput) => {
      const candidates = normalizeCandidates(input);
      if (candidates.length === 0) return;
      const progress = useImportProgressStore.getState();
      if (progress.active) {
        toast.info(t("media.importBusy"));
        return;
      }
      setImporting(true);
      progress.start(candidates.length);
      let desktopRequired = 0;
      try {
        const { done, failed, cancelled } = await runMediaImportBatch(candidates, {
          importFile: importMediaFile,
          importHeicFile: importDesktopHeicFile,
          isHeicFile,
          hasAsset: (assetId) =>
            useProjectStore.getState().project.mediaLibrary.some((asset) => asset.id === assetId),
          addMediaAsset,
          isCancelRequested: () => useImportProgressStore.getState().cancelRequested,
          onFileStart: (name) => useImportProgressStore.getState().beginFile(name),
          onFileDone: () => useImportProgressStore.getState().fileDone(),
          onFileFailed: (candidate, error) => {
            useImportFailureStore.getState().add(createMediaImportFailure(candidate, error));
            if (error instanceof DesktopHeicImportError && error.code === "DESKTOP_REQUIRED") {
              desktopRequired += 1;
            }
            useImportProgressStore.getState().fileFailed();
          },
        });

        const skipped = candidates.length - done - failed;
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
