import type { ID, MediaAsset } from "@movie-desk/core";
import { leaseMediaKey } from "@/persistence/media-gc";
import { readMediaFile } from "@/persistence/opfs";
import { useMusicLibraryStore } from "@/stores/music-library-store";
import { estimateTrackBpm } from "./bpm";
import { hashBlob, musicStoreKey, safeFileName, saveMusicFile } from "./file-store";

// After linking an asset to a music ref: copy the bytes into the app-global
// store (cross-project restore) and analyze the track's BPM (tempo-aware
// recommendations). Fire-and-forget from UI handlers — a failure only
// loses the enrichment, never the project-local link.
export const enrichRefFromAsset = async (refId: ID, asset: MediaAsset): Promise<void> => {
  try {
    const blob = await readMediaFile(asset.opfsPath);
    if (!blob) return;
    const { updateRef } = useMusicLibraryStore.getState();
    const fileHash = await hashBlob(blob);
    // Leased across the write→ref-commit gap so GC can't reap it.
    const releaseStore = leaseMediaKey(musicStoreKey(fileHash));
    try {
      const fileName = safeFileName(asset.name);
      await saveMusicFile(fileHash, new File([blob], fileName, { type: blob.type }));
      updateRef(refId, { fileHash, fileName });
    } finally {
      releaseStore();
    }
    // The first ~90s is plenty for tempo estimation — don't decode a
    // full-length WAV into PCM on the main thread.
    const bpm = await estimateTrackBpm(blob.slice(0, 4 * 1024 * 1024));
    if (bpm) updateRef(refId, { bpm });
  } catch {
    // Enrichment is best-effort.
  }
};
