import { newId, type MediaAsset } from "@movie-desk/core";
import { writeMediaFile } from "@/persistence/opfs";
import { probeMedia } from "./probe";
import { makeImageThumb, makeVideoThumb, makeVideoFilmstrip } from "./thumbnail";
import { extractWaveformPeaks } from "./waveform";
import { leaseMediaKey } from "@/persistence/media-gc";
import { extractCaptureMeta } from "@/autoedit/metadata";

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

    let thumbDataUrl: string | undefined;
    let filmstripDataUrl: string | undefined;
    let filmstripFrames: number | undefined;
    try {
      if (probe.kind === "image") thumbDataUrl = await makeImageThumb(file);
      else if (probe.kind === "video") {
        thumbDataUrl = await makeVideoThumb(file);
        const strip = await makeVideoFilmstrip(file);
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
      const peaks = await extractWaveformPeaks(file);
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
      importedAt: Date.now(),
    };

    return { asset, releaseLease };
  } catch (error) {
    releaseLease();
    throw error;
  }
};
