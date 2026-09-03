import { type ID, type MediaAsset, newId } from "@movie-desk/core";
import {
  type MediaImportCandidate,
  linkImportedLivePhotos,
  planLivePhotoLinks,
} from "./folder-import";
import type { ImportResult } from "./import";

// Runs one import batch: every file in turn, then Live Photo pairing, then
// registration in the project. A file's OPFS lease stays held across that
// whole span. Releasing it right after the file lands would open a window in
// which startup GC, seeing neither a lease nor a project reference, deletes
// the file before the batch registers it.

export interface MediaImportBatchDependencies {
  readonly importFile: (file: File) => Promise<ImportResult>;
  // Desktop-side HEIC conversion; its output is not leased in this process.
  readonly importHeicFile: (file: File) => Promise<MediaAsset>;
  readonly isHeicFile: (file: File) => boolean;
  readonly hasAsset: (assetId: ID) => boolean;
  readonly addMediaAsset: (asset: MediaAsset) => void;
  readonly isCancelRequested: () => boolean;
  readonly onFileStart: (name: string) => void;
  readonly onFileDone: () => void;
  readonly onFileFailed: (candidate: MediaImportCandidate, error: unknown) => void;
  readonly createPairId?: () => ID;
}

export interface MediaImportBatchSummary {
  readonly done: number;
  readonly failed: number;
  readonly cancelled: boolean;
}

interface ImportedEntry {
  readonly asset: MediaAsset;
  readonly candidateIndex: number;
  readonly releaseLease?: () => void;
}

export const runMediaImportBatch = async (
  candidates: readonly MediaImportCandidate[],
  deps: MediaImportBatchDependencies,
): Promise<MediaImportBatchSummary> => {
  const livePhotoPlan = planLivePhotoLinks(candidates);
  const imported: ImportedEntry[] = [];
  // Leases still protecting an imported file. Each is released exactly once:
  // right after its asset is registered, or on the way out for whatever the
  // batch did not get to register.
  const heldLeases = new Set<() => void>();
  const release = (lease: (() => void) | undefined): void => {
    if (lease && heldLeases.delete(lease)) lease();
  };
  let done = 0;
  let failed = 0;
  let cancelled = false;
  try {
    for (const [candidateIndex, candidate] of candidates.entries()) {
      if (deps.isCancelRequested()) {
        cancelled = true;
        break;
      }
      const { file } = candidate;
      deps.onFileStart(file.name);
      try {
        // Files are processed serially to keep memory bounded.
        if (deps.isHeicFile(file)) {
          const asset = await deps.importHeicFile(file);
          if (!deps.hasAsset(asset.id)) imported.push({ asset, candidateIndex });
        } else {
          const { asset, releaseLease } = await deps.importFile(file);
          heldLeases.add(releaseLease);
          imported.push({ asset, candidateIndex, releaseLease });
        }
        done += 1;
        deps.onFileDone();
      } catch (error) {
        // One bad file must not abort the whole batch.
        failed += 1;
        deps.onFileFailed(candidate, error);
      }
    }

    // Linking maps entry by entry, so the lease at an index belongs to the
    // asset at the same index.
    const linked = linkImportedLivePhotos(imported, livePhotoPlan, deps.createPairId ?? newId);
    if (linked.length !== imported.length) {
      throw new Error("Live Photo linking must return one asset per imported file");
    }
    imported.forEach((entry, index) => {
      deps.addMediaAsset(linked[index] as MediaAsset);
      // The project references the file now; GC keeps it without the lease.
      release(entry.releaseLease);
    });
  } finally {
    for (const lease of [...heldLeases]) release(lease);
  }
  return { done, failed, cancelled };
};
