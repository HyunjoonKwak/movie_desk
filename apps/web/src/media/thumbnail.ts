import { sampleFramesAt } from "@/renderer/frame-sampler";
import type { SourceRotation } from "@movie-desk/core";

// Generate a small thumbnail data URL for the media bin. Video frames come
// from the shared frame sampler (one decode pass, rotation applied); images
// are downscaled directly.

const TARGET = 240;

const drawToDataUrl = (
  source: HTMLVideoElement | HTMLImageElement,
  w: number,
  h: number,
): string => {
  const ratio = w / h;
  const tw = Math.min(TARGET, w);
  const th = Math.round(tw / ratio);
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(source, 0, 0, tw, th);
  return canvas.toDataURL("image/webp", 0.7);
};

export const makeImageThumb = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const data = drawToDataUrl(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("thumb-image"));
    };
    img.src = url;
  });

// Frame height for filmstrip tiles; width derives from the video aspect ratio.
const STRIP_H = 48;

const toWebp = (canvas: HTMLCanvasElement, quality: number): string =>
  canvas.toDataURL("image/webp", quality);

// Builds a wide filmstrip image sampling `frames` evenly-spaced frames across
// the whole source. Returns the data URL and the actual frame count drawn.
export const makeVideoFilmstrip = async (
  file: File,
  frames = 10,
  rotation?: SourceRotation,
): Promise<{ dataUrl: string; frames: number } | null> => {
  const n = Math.max(2, Math.min(frames, 30));
  let tileW = 0;
  try {
    const sampled = await sampleFramesAt(
      file,
      // Sample at the center of each segment to avoid black intro frames.
      (durationMs) =>
        Array.from({ length: n }, (_, i) =>
          Math.min(((i + 0.5) / n) * durationMs, Math.max(0, durationMs - 50)),
        ),
      {
        size: (w, h) => {
          tileW = Math.max(1, Math.round(STRIP_H * (w / h || 16 / 9)));
          return { width: tileW, height: STRIP_H };
        },
        ...(rotation ? { rotation } : {}),
      },
    );
    if (sampled.length === 0 || tileW === 0) return null;
    // The sampler collapses duplicate times (a clip shorter than the tile
    // count, or one whose duration is unknown), so the strip is sized by the
    // frames actually sampled, not the frames requested.
    const drawn = sampled.slice(0, n);
    const canvas = document.createElement("canvas");
    canvas.width = tileW * drawn.length;
    canvas.height = STRIP_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawn.forEach((sample, i) => ctx.putImageData(sample.image, i * tileW, 0));
    return { dataUrl: toWebp(canvas, 0.6), frames: drawn.length };
  } catch {
    return null;
  }
};

export const makeVideoThumb = async (
  file: File,
  atSec = 0.1,
  rotation?: SourceRotation,
): Promise<string> => {
  const [sample] = await sampleFramesAt(
    file,
    (durationMs) => [Math.min(atSec * 1000, Math.max(0, durationMs - 100))],
    {
      size: (w, h) => {
        const tw = Math.min(TARGET, w);
        return { width: tw, height: Math.max(1, Math.round(tw / (w / h || 16 / 9))) };
      },
      ...(rotation ? { rotation } : {}),
    },
  );
  if (!sample) throw new Error("thumb-video");
  const canvas = document.createElement("canvas");
  canvas.width = sample.image.width;
  canvas.height = sample.image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.putImageData(sample.image, 0, 0);
  return toWebp(canvas, 0.7);
};
