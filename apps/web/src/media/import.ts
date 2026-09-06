import { create } from "zustand";
import { MediaSourceError } from "./source/media-source";
import { resolveMediaSource } from "./source/resolve-media-source";
import { extractCaptureMeta } from "@/autoedit/metadata";
import { leaseMediaKey } from "@/persistence/media-gc";
import { readMediaFile, writeMediaFile } from "@/persistence/opfs";
import { leasePreview, putAssetPreviews } from "@/persistence/previews";
import { type MediaAsset, newId, sourceRefOf } from "@movie-desk/core";
import { audioVariantKey, ensureAudioVariant } from "./audio/audio-variant";
import { readMp4ContainerInfo } from "./container-info";
import { probeMedia } from "./probe";
import { makeImageThumb, makeVideoFilmstrip, makeVideoThumb } from "./thumbnail";
import { extractWaveformPeaks } from "./waveform";

export interface ImportResult {
  asset: MediaAsset;
  releaseLease: () => void;
}

export const importMediaFile = async (file: File): Promise<ImportResult> => {
  const probe = await probeMedia(file);
  const id = newId();
  const opfsPath = `${id}__${file.name}`;
  // Both files this import writes stay out of GC's reach until the caller
  // has registered the asset; the batch releases them together.
  const releaseOriginal = leaseMediaKey(opfsPath);
  const releaseVariant = leaseMediaKey(audioVariantKey({ opfsPath, sizeBytes: file.size }));
  const releasePreviews = leasePreview(id);
  const releaseLease = (): void => {
    releaseOriginal();
    releaseVariant();
    releasePreviews();
  };
  try {
    await writeMediaFile(opfsPath, file);

    // Container facts (iPhone portrait rotation, codec strings). The <video>
    // probe already reports rotated dimensions; WebCodecs frames need the
    // rotation to match, and the codecs make the library searchable.
    let rotation: MediaAsset["rotation"];
    let videoCodec: string | undefined;
    let audioCodec: string | undefined;
    if (probe.kind === "video" || probe.kind === "audio") {
      const container = await readMp4ContainerInfo(file).catch(() => null);
      if (container?.rotation) rotation = container.rotation;
      if (container?.videoCodec) videoCodec = container.videoCodec;
      if (container?.audioCodec) audioCodec = container.audioCodec;
    }

    let thumbDataUrl: string | undefined;
    let filmstripDataUrl: string | undefined;
    let filmstripFrames: number | undefined;
    try {
      if (probe.kind === "image") thumbDataUrl = await makeImageThumb(file);
      else if (probe.kind === "video") {
        thumbDataUrl = await makeVideoThumb(file, 0.1, rotation);
        const strip = await makeVideoFilmstrip(file, 10, rotation);
        if (strip) {
          filmstripDataUrl = strip.dataUrl;
          filmstripFrames = strip.frames;
        }
      }
    } catch {
      thumbDataUrl = undefined;
    }
    // Pictures go to the preview store, not the record. If that store is
    // unavailable they stay inline (fat record, but a visible thumbnail)
    // and the migration retries later.
    let inlinePreviews = false;

    // Extract a peak envelope for audio-bearing media so the timeline can draw
    // a waveform. Images skip this.
    let waveformPeaks: number[] | undefined;
    if (probe.kind === "audio" || probe.kind === "video") {
      // Build the audio-track variant now so the waveform, preview and export
      // all decode the small audio-only file instead of the whole original.
      const audio =
        (await ensureAudioVariant({
          opfsPath,
          sizeBytes: file.size,
          mime: probe.mime,
          kind: probe.kind,
        })) ?? file;
      const peaks = await extractWaveformPeaks(audio);
      if (peaks) waveformPeaks = peaks;
    }

    if (thumbDataUrl || filmstripDataUrl || waveformPeaks) {
      try {
        await putAssetPreviews(id, {
          ...(thumbDataUrl ? { thumb: thumbDataUrl } : {}),
          ...(filmstripDataUrl
            ? { filmstrip: { dataUrl: filmstripDataUrl, frames: filmstripFrames ?? 0 } }
            : {}),
          ...(waveformPeaks ? { waveform: waveformPeaks } : {}),
        });
      } catch {
        inlinePreviews = true;
      }
    }

    // Capture time + GPS for the auto-edit story engine (EXIF / mvhd / ISO6709).
    // File.lastModified is the honest fallback when the container has no clock.
    const capture = await extractCaptureMeta(file, probe.kind, file.lastModified);

    const asset: MediaAsset = {
      id,
      name: file.name,
      kind: probe.kind,
      mime: probe.mime,
      durationMs: probe.durationMs,
      ...(probe.width !== undefined ? { width: probe.width } : {}),
      ...(probe.height !== undefined ? { height: probe.height } : {}),
      opfsPath,
      sizeBytes: file.size,
      ...(capture.capturedAt !== undefined ? { capturedAt: capture.capturedAt } : {}),
      ...(capture.gpsLat !== undefined && capture.gpsLon !== undefined
        ? { gpsLat: capture.gpsLat, gpsLon: capture.gpsLon }
        : {}),
      ...(inlinePreviews && thumbDataUrl ? { thumbDataUrl } : {}),
      ...(inlinePreviews && filmstripDataUrl ? { filmstripDataUrl } : {}),
      ...(inlinePreviews && filmstripFrames !== undefined ? { filmstripFrames } : {}),
      ...(inlinePreviews && waveformPeaks ? { waveformPeaks } : {}),
      ...(audioCodec || waveformPeaks ? { hasAudio: true } : {}),
      ...(rotation ? { rotation } : {}),
      ...(videoCodec ? { videoCodec } : {}),
      ...(audioCodec ? { audioCodec } : {}),
      importedAt: Date.now(),
    };

    return { asset, releaseLease };
  } catch (error) {
    releaseLease();
    throw error;
  }
};

export type PreviewKind = "thumb" | "filmstrip" | "waveform";
export interface RegenerationResult {
  readonly failed: readonly PreviewKind[];
}
export class PreviewRegenerationError extends Error {
  constructor(
    readonly kind: "decode" | "storage",
    options?: ErrorOptions,
  ) {
    super(`Preview ${kind} failed`, options);
  }
}
export const usePreviewRegenerationStore = create<{ readonly pending: ReadonlySet<string> }>(
  () => ({ pending: new Set() }),
);
export const REGENERATION_TIMEOUT_MS = 60_000;
const MAX_ACTIVE_REGENERATIONS = 2;
const regenerationJobs = new Map<string, Promise<RegenerationResult>>();
const slots: (() => void)[] = [];
let activeRegenerations = 0;
const acquireSlot = async () => {
  if (activeRegenerations >= MAX_ACTIVE_REGENERATIONS)
    await new Promise<void>((resolve) => slots.push(resolve));
  else activeRegenerations++;
};
const releaseSlot = () => {
  const next = slots.shift();
  if (next) next();
  else activeRegenerations--;
};

const rebuildPreviews = async (asset: MediaAsset): Promise<RegenerationResult> => {
  const releases: (() => void)[] = [];
  let expired = false;
  const assertActive = () => {
    if (expired) throw new PreviewRegenerationError("decode");
  };
  const build = async (): Promise<RegenerationResult> => {
    const ref = sourceRefOf(asset);
    releases.push(leasePreview(asset.id));
    releases.push(leaseMediaKey(ref.kind === "opfs" ? ref.key : asset.opfsPath));
    releases.push(leaseMediaKey(audioVariantKey(asset)));
    const blob = ref.kind === "opfs" ? await readMediaFile(ref.key) : null;
    assertActive();
    if (ref.kind === "opfs" && !blob) throw new MediaSourceError("offline", "Original unavailable");
    // OPFS File references its backing Blob; disk sources stay ranged through the sampler.
    const source = blob
      ? new File([blob], asset.name, { type: asset.mime })
      : await resolveMediaSource(asset);
    assertActive();
    const attempt = async <T>(run: () => Promise<T>): Promise<T | null> => {
      try {
        const result = await run();
        assertActive();
        return result;
      } catch (error) {
        if (expired || error instanceof MediaSourceError) throw error;
        return null;
      }
    };
    const thumb =
      asset.kind === "image"
        ? await attempt(() => makeImageThumb(source))
        : asset.kind === "video"
          ? await attempt(() => makeVideoThumb(source, 0.1, asset.rotation))
          : null;
    const filmstrip =
      asset.kind === "video"
        ? await attempt(() => makeVideoFilmstrip(source, 10, asset.rotation))
        : null;
    // Do not decode a whole video container when the audio-only variant is unavailable.
    const waveform =
      asset.kind !== "image"
        ? await attempt(async () => {
            const variant = await ensureAudioVariant(asset);
            assertActive();
            const audio = variant ?? (asset.kind === "audio" ? blob : null);
            return audio ? extractWaveformPeaks(audio) : null;
          })
        : null;
    const failed: PreviewKind[] = [];
    if (asset.kind !== "audio" && !thumb) failed.push("thumb");
    if (asset.kind === "video" && !filmstrip) failed.push("filmstrip");
    if (asset.kind !== "image" && asset.hasAudio && !waveform) failed.push("waveform");
    if (!thumb && !filmstrip && !waveform) throw new PreviewRegenerationError("decode");
    try {
      await putAssetPreviews(
        asset.id,
        {
          ...(thumb ? { thumb } : {}),
          ...(filmstrip ? { filmstrip } : {}),
          ...(waveform ? { waveform } : {}),
        },
        { replaceMissing: failed.length === 0 },
      );
    } catch (cause) {
      throw new PreviewRegenerationError("storage", { cause });
    }
    return { failed };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new PreviewRegenerationError("decode"));
    }, REGENERATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([build(), timeout]);
  } finally {
    expired = true;
    clearTimeout(timer);
    for (const release of [...releases].reverse()) release();
  }
};

export const regenerateAssetPreviews = (asset: MediaAsset): Promise<RegenerationResult> => {
  const existing = regenerationJobs.get(asset.id);
  if (existing) return existing;
  const job = (async () => {
    await acquireSlot();
    try {
      return await rebuildPreviews(asset);
    } finally {
      releaseSlot();
    }
  })().finally(() => {
    regenerationJobs.delete(asset.id);
    usePreviewRegenerationStore.setState({ pending: new Set(regenerationJobs.keys()) });
  });
  regenerationJobs.set(asset.id, job);
  usePreviewRegenerationStore.setState({ pending: new Set(regenerationJobs.keys()) });
  return job;
};
