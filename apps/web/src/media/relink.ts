import { leaseMediaKey } from "@/persistence/media-gc";
import { deleteMediaFile, writeMediaFile } from "@/persistence/opfs";
import { formatBytes } from "@/media/format";
import type { MediaAsset } from "@movie-desk/core";
import { audioVariantKey } from "./audio/audio-variant";

// Relinking a missing asset: the user points at a file, we make sure it is
// the same media (size first; the D1 rule is never to swap in a look-alike
// silently), then write it back under the asset's own OPFS key so every clip
// keeps working. Referenced desktop files relink through the catalog instead
// and are out of scope here.

export type RelinkVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "size" | "name";
      readonly expected: string;
      readonly actual: string;
    };

export const canRelinkFromFile = (asset: MediaAsset): boolean =>
  !asset.sourceRef || asset.sourceRef.kind === "opfs";

// Size is the fingerprint we always have; when it is unknown (older records)
// the name has to match instead.
export const compareRelinkCandidate = (asset: MediaAsset, file: File): RelinkVerdict => {
  if (asset.sizeBytes !== undefined) {
    return file.size === asset.sizeBytes
      ? { ok: true }
      : {
          ok: false,
          reason: "size",
          expected: formatBytes(asset.sizeBytes),
          actual: formatBytes(file.size),
        };
  }
  return file.name === asset.name
    ? { ok: true }
    : { ok: false, reason: "name", expected: asset.name, actual: file.name };
};

export interface RelinkPatch {
  readonly sizeBytes: number;
  readonly mime: string;
}

// Writes the chosen file under the asset's key. The lease keeps startup GC
// off the key while the copy is in flight; the stale audio variant is dropped
// so it is rebuilt from the new bytes.
export const relinkAssetFromFile = async (asset: MediaAsset, file: File): Promise<RelinkPatch> => {
  const release = leaseMediaKey(asset.opfsPath);
  try {
    await writeMediaFile(asset.opfsPath, file);
    if (asset.kind !== "image") await deleteMediaFile(audioVariantKey(asset));
    return { sizeBytes: file.size, mime: file.type || asset.mime };
  } finally {
    release();
  }
};
