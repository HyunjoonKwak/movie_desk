import { extractCaptureMeta } from "@/autoedit/metadata";
import { leaseMediaKey } from "@/persistence/media-gc";
import { writeMediaFile } from "@/persistence/opfs";
import { type MediaAsset, newId } from "@movie-desk/core";
import { ensureAudioVariant } from "./audio/audio-variant";
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
  const releaseLease = leaseMediaKey(opfsPath);
  try {
    await writeMediaFile(opfsPath, file);

    // Container display rotation (iPhone portrait). The <video> probe already
    // reports rotated dimensions; WebCodecs frames need this to match.
    let rotation: MediaAsset["rotation"];
    if (probe.kind === "video") {
      const container = await readMp4ContainerInfo(file).catch(() => null);
      if (container && container.rotation !== 0) rotation = container.rotation;
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
      importedAt: Date.now(),
    };

    return { asset, releaseLease };
  } catch (error) {
    releaseLease();
    throw error;
  }
};
