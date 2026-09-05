import { formatBytes } from "@/media/format";
import { leaseMediaKey } from "@/persistence/media-gc";
import { deleteMediaFile, replaceMediaFile } from "@/persistence/opfs";
import { putAssetPreviews } from "@/persistence/previews";
import type { MediaAsset, SourceRotation } from "@movie-desk/core";
import { audioVariantKey } from "./audio/audio-variant";
import { readMp4ContainerInfo } from "./container-info";
import { probeMedia } from "./probe";
import { makeImageThumb, makeVideoFilmstrip, makeVideoThumb } from "./thumbnail";
import { extractWaveformPeaks } from "./waveform";

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

// What a relink changes on the record. For a file that is not the imported
// one, everything derived from the old bytes is replaced or dropped: proxy,
// duration, dimensions, rotation, codecs, thumbnail, filmstrip, waveform.
export interface RelinkPatch {
  readonly sizeBytes: number;
  readonly mime: string;
  readonly dropProxy: boolean;
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: SourceRotation;
  readonly videoCodec?: string | null; // null clears a codec the new file lacks
  readonly audioCodec?: string | null;
  readonly thumbDataUrl?: string | null;
  readonly filmstripDataUrl?: string | null;
  readonly filmstripFrames?: number | null;
  readonly waveformPeaks?: readonly number[] | null;
}

export interface RelinkDependencies {
  readonly replace: (key: string, file: File) => Promise<string>;
  readonly remove: (key: string) => Promise<void>;
  readonly probe: typeof probeMedia;
  readonly containerInfo: typeof readMp4ContainerInfo;
  readonly imageThumb: typeof makeImageThumb;
  readonly videoThumb: typeof makeVideoThumb;
  readonly filmstrip: typeof makeVideoFilmstrip;
  readonly waveform: typeof extractWaveformPeaks;
  readonly storePreviews: typeof putAssetPreviews;
}

const defaultDependencies: RelinkDependencies = {
  replace: replaceMediaFile,
  remove: deleteMediaFile,
  probe: probeMedia,
  containerInfo: readMp4ContainerInfo,
  imageThumb: makeImageThumb,
  videoThumb: makeVideoThumb,
  filmstrip: makeVideoFilmstrip,
  waveform: extractWaveformPeaks,
  storePreviews: putAssetPreviews,
};

// Best-effort derived visuals for the new bytes; a failure leaves the field
// cleared rather than showing the old file's picture.
const derivedFacts = async (
  file: File,
  kind: MediaAsset["kind"],
  rotation: SourceRotation | undefined,
  deps: RelinkDependencies,
): Promise<
  Pick<RelinkPatch, "thumbDataUrl" | "filmstripDataUrl" | "filmstripFrames" | "waveformPeaks">
> => {
  let thumbDataUrl: string | null = null;
  let filmstripDataUrl: string | null = null;
  let filmstripFrames: number | null = null;
  let waveformPeaks: readonly number[] | null = null;
  try {
    if (kind === "image") thumbDataUrl = await deps.imageThumb(file);
    else if (kind === "video") {
      thumbDataUrl = await deps.videoThumb(file, 0.1, rotation);
      const strip = await deps.filmstrip(file, 10, rotation);
      if (strip) {
        filmstripDataUrl = strip.dataUrl;
        filmstripFrames = strip.frames;
      }
    }
  } catch {
    thumbDataUrl = null;
  }
  if (kind !== "image") {
    try {
      waveformPeaks = (await deps.waveform(file)) ?? null;
    } catch {
      waveformPeaks = null;
    }
  }
  return { thumbDataUrl, filmstripDataUrl, filmstripFrames, waveformPeaks };
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
      probe && probe.kind !== "image" ? await deps.containerInfo(file).catch(() => null) : null;
    const rotation = container?.rotation;
    const visuals = await derivedFacts(file, probe?.kind ?? asset.kind, rotation, deps);
    // New pictures go to the preview store; the record only clears any
    // inline (legacy) ones. If the store fails, the patch carries them.
    let stored = false;
    try {
      await deps.storePreviews(asset.id, {
        ...(visuals.thumbDataUrl ? { thumb: visuals.thumbDataUrl } : {}),
        ...(visuals.filmstripDataUrl
          ? {
              filmstrip: {
                dataUrl: visuals.filmstripDataUrl,
                frames: visuals.filmstripFrames ?? 0,
              },
            }
          : {}),
      });
      stored = true;
    } catch {
      stored = false;
    }
    return {
      ...base,
      dropProxy: true,
      ...(probe ? { durationMs: probe.durationMs } : {}),
      ...(probe?.width !== undefined ? { width: probe.width } : {}),
      ...(probe?.height !== undefined ? { height: probe.height } : {}),
      ...(rotation !== undefined ? { rotation } : {}),
      videoCodec: container?.videoCodec ?? null,
      audioCodec: container?.audioCodec ?? null,
      ...visuals,
      ...(stored ? { thumbDataUrl: null, filmstripDataUrl: null, filmstripFrames: null } : {}),
    };
  } finally {
    release();
  }
};
