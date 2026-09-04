import { extractCaptureMeta } from "@/autoedit/metadata";
import { leaseMediaKey } from "@/persistence/media-gc";
import { writeMediaFile } from "@/persistence/opfs";
import { type MediaAsset, newId } from "@movie-desk/core";
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
  const releaseLease = (): void => {
    releaseOriginal();
    releaseVariant();
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
      ...(thumbDataUrl ? { thumbDataUrl } : {}),
      ...(filmstripDataUrl ? { filmstripDataUrl } : {}),
      ...(filmstripFrames !== undefined ? { filmstripFrames } : {}),
      ...(waveformPeaks ? { waveformPeaks } : {}),
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
