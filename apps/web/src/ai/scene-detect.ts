import { streamFramesAt } from "@/renderer/frame-sampler";
import type { SceneCut } from "./types";

// Lightweight scene cut detector. Samples the video at a coarse FPS through
// the shared frame sampler (one WebCodecs pass, media-element fallback),
// computes a normalised RGB histogram per frame, and emits a cut when
// consecutive frames differ by more than `threshold` (χ²-like).

const FRAME_FPS = 2; // sample at 2 fps — enough for cut detection
const THUMB_SIZE = 64;
const BUCKETS = 8; // per channel

const histogram = (data: Uint8ClampedArray): Float32Array => {
  const h = new Float32Array(BUCKETS * 3);
  const step = 256 / BUCKETS;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    h[Math.min(BUCKETS - 1, Math.floor(data[i]! / step))]!++;
    h[BUCKETS + Math.min(BUCKETS - 1, Math.floor(data[i + 1]! / step))]!++;
    h[2 * BUCKETS + Math.min(BUCKETS - 1, Math.floor(data[i + 2]! / step))]!++;
    n++;
  }
  // Normalise to a distribution.
  for (let i = 0; i < h.length; i++) h[i]! /= Math.max(1, n);
  return h;
};

const chiSquared = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    const denom = ai + bi;
    if (denom > 0) s += (ai - bi) ** 2 / denom;
  }
  return s;
};

export const detectScenesFromBlob = async (
  blob: Blob,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<readonly SceneCut[]> => {
  const cuts: SceneCut[] = [];
  const threshold = 0.45;
  // Only the previous histogram is kept: a long video never accumulates frames.
  let prev: Float32Array | null = null;
  await streamFramesAt(
    blob,
    (durationMs) => {
      const samples = Math.max(2, Math.floor((durationMs / 1000) * FRAME_FPS));
      return Array.from({ length: samples }, (_, i) => (i / samples) * durationMs);
    },
    {
      size: { width: THUMB_SIZE, height: THUMB_SIZE },
      ...(signal ? { signal } : {}),
      onProgress: (done, total) => {
        if (done % 4 === 0) onProgress?.(done / total);
      },
    },
    ({ atMs, image }) => {
      const h = histogram(image.data);
      if (prev) {
        const diff = chiSquared(prev, h);
        if (diff > threshold) cuts.push({ atMs: Math.round(atMs), score: diff });
      }
      prev = h;
    },
  );
  onProgress?.(1);
  // Merge cuts that are within 800ms of each other (Whisper-style hysteresis).
  return cuts.filter((c, i, arr) => i === 0 || c.atMs - arr[i - 1]!.atMs > 800);
};
