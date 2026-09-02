import type { MediaKind } from "@movie-desk/core";

export interface ProbeResult {
  kind: MediaKind;
  mime: string;
  durationMs: number;
  width?: number;
  height?: number;
}

const kindFromMime = (mime: string): MediaKind => {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "image";
};

// Use HTMLMediaElement metadata as a fast first-pass probe. Good enough
// for ingest before we wire up mediabunny for accurate demuxing.
export const probeMedia = (file: File): Promise<ProbeResult> => {
  const mime = file.type || "application/octet-stream";
  const kind = kindFromMime(mime);

  if (kind === "image") {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const result: ProbeResult = {
          kind,
          mime,
          durationMs: 5000, // sensible default — image stills last 5s
          width: img.naturalWidth,
          height: img.naturalHeight,
        };
        URL.revokeObjectURL(url);
        resolve(result);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load image"));
      };
      img.src = url;
    });
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind === "video" ? "video" : "audio") as
      | HTMLVideoElement
      | HTMLAudioElement;
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const isVideo = el instanceof HTMLVideoElement;
      const durationMs = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0;
      const result: ProbeResult = {
        kind,
        mime,
        durationMs,
        ...(isVideo ? { width: el.videoWidth, height: el.videoHeight } : {}),
      };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to probe ${kind}`));
    };
    el.src = url;
  });
};
