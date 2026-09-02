import { acquireMediaUrl, readMediaFile } from "@/persistence/opfs";
import type { MediaAsset } from "@movie-desk/core";
import { sourceRefOf } from "@movie-desk/core";
import {
  MediaSourceError,
  type PlaybackLease,
  type RandomAccessMediaSource,
  clampReadRange,
} from "./media-source";

// Legacy adapter: the asset's bytes are a Blob in the app's OPFS store.
// Blob.slice is zero-copy until the range is actually read.
export const blobMediaSource = (
  assetId: string,
  mime: string,
  blob: Blob,
  acquire: () => Promise<PlaybackLease>,
): RandomAccessMediaSource => ({
  assetId,
  sizeBytes: blob.size,
  mime,
  read: async (start, length) => {
    const range = clampReadRange(start, length, blob.size);
    if (range.length === 0) return new ArrayBuffer(0);
    return blob.slice(range.start, range.start + range.length).arrayBuffer();
  },
  acquirePlaybackUrl: acquire,
});

export const createOpfsMediaSource = async (
  asset: MediaAsset,
): Promise<RandomAccessMediaSource> => {
  const ref = sourceRefOf(asset);
  const key = ref.kind === "opfs" ? ref.key : asset.opfsPath;
  const blob = await readMediaFile(key);
  if (!blob) throw new MediaSourceError("offline", `OPFS copy is missing: ${key}`);
  return blobMediaSource(asset.id, asset.mime, blob, async () => {
    const lease = await acquireMediaUrl(key);
    if (!lease) throw new MediaSourceError("offline", `OPFS copy is missing: ${key}`);
    return lease;
  });
};
