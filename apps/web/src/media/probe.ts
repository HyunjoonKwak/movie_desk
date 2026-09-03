import type { MediaKind } from "@movie-desk/core";

export interface ProbeResult {
  kind: MediaKind;
  mime: string;
  durationMs: number;
  width?: number;
  height?: number;
}

class MediaProbeError extends Error {
  readonly code: "UNSUPPORTED_MEDIA" | "DECODE_FAILED";

  constructor(code: MediaProbeError["code"], message: string) {
    super(message);
    this.name = "MediaProbeError";
    this.code = code;
  }
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  aac: "audio/aac",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  flac: "audio/flac",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  wav: "audio/wav",
  webm: "video/webm",
};

export const mediaMimeForFile = (file: Pick<File, "name" | "type">): string => {
  if (/^(video|audio|image)\//.test(file.type)) return file.type;
  const extension = /\.([^.]+)$/.exec(file.name)?.[1]?.toLocaleLowerCase("en-US") ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
};

const kindFromMime = (mime: string): MediaKind => {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "image";
};

// Use HTMLMediaElement metadata as a fast first-pass probe. Good enough
// for ingest before we wire up mediabunny for accurate demuxing.
export const probeMedia = (file: File): Promise<ProbeResult> => {
  const mime = mediaMimeForFile(file);
  if (mime === "application/octet-stream") {
    return Promise.reject(
      new MediaProbeError("UNSUPPORTED_MEDIA", "The selected file is not a supported media type"),
    );
  }
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
        const normallyDecodable = new Set([
          "image/avif",
          "image/gif",
          "image/jpeg",
          "image/png",
          "image/webp",
        ]).has(mime);
        reject(
          new MediaProbeError(
            normallyDecodable ? "DECODE_FAILED" : "UNSUPPORTED_MEDIA",
            "The image could not be decoded",
          ),
        );
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
      reject(
        new MediaProbeError(
          el.error?.code === 4 ? "UNSUPPORTED_MEDIA" : "DECODE_FAILED",
          `The ${kind} file could not be decoded`,
        ),
      );
    };
    el.src = url;
  });
};
