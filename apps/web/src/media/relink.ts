import { leaseMediaKey } from "@/persistence/media-gc";
import { deleteMediaFile, replaceMediaFile } from "@/persistence/opfs";
import { formatBytes } from "@/media/format";
import type { MediaAsset, SourceRotation } from "@movie-desk/core";
import { audioVariantKey } from "./audio/audio-variant";
import { readMp4ContainerInfo } from "./container-info";
import { probeMedia } from "./probe";

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
  // Only when the file is not the one that was imported: the proxy, duration,
  // dimensions and rotation belonged to the old bytes.
  readonly dropProxy: boolean;
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: SourceRotation;
}

export interface RelinkDependencies {
  readonly replace: (key: string, file: File) => Promise<string>;
  readonly remove: (key: string) => Promise<void>;
  readonly probe: typeof probeMedia;
  readonly containerInfo: typeof readMp4ContainerInfo;
}

const defaultDependencies: RelinkDependencies = {
  replace: replaceMediaFile,
  remove: deleteMediaFile,
  probe: probeMedia,
  containerInfo: readMp4ContainerInfo,
};

// Writes the chosen file under the asset's key (never leaving it
// half-written). The lease keeps startup GC off the key while the copy is
// in flight; the stale audio variant is dropped so it is rebuilt from the
// new bytes. A file that is not the imported one also loses its proxy and
// gets its facts re-read.
export const relinkAssetFromFile = async (
  asset: MediaAsset,
  file: File,
  { identical = true }: { readonly identical?: boolean } = {},
  deps: RelinkDependencies = defaultDependencies,
): Promise<RelinkPatch> => {
  const release = leaseMediaKey(asset.opfsPath);
  try {
    await deps.replace(asset.opfsPath, file);
    if (asset.kind !== "image") await deps.remove(audioVariantKey(asset));
    const base = { sizeBytes: file.size, mime: file.type || asset.mime };
    if (identical) return { ...base, dropProxy: false };
    if (asset.proxyPath) await deps.remove(asset.proxyPath);
    const probe = await deps.probe(file).catch(() => null);
    const container =
      probe?.kind === "video" ? await deps.containerInfo(file).catch(() => null) : null;
    return {
      ...base,
      dropProxy: true,
      ...(probe ? { durationMs: probe.durationMs } : {}),
      ...(probe?.width !== undefined ? { width: probe.width } : {}),
      ...(probe?.height !== undefined ? { height: probe.height } : {}),
      ...(container ? { rotation: container.rotation } : {}),
    };
  } finally {
    release();
  }
};
