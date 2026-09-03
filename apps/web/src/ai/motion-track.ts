// Lightweight motion tracker. Given a video blob, a starting rectangle
// (normalized 0..1), and a time range, it samples frames through the shared
// frame sampler and follows the template patch using a local normalized
// cross-correlation (NCC) search.
// Emits a list of normalized center points per timestamp; the caller turns
// those into transform keyframes.

import { streamFramesAt } from "@/renderer/frame-sampler";

export interface TrackPoint {
  readonly atMs: number;
  readonly x: number; // normalized center [0..1]
  readonly y: number;
}

export interface TrackRegion {
  readonly x: number; // normalized top-left
  readonly y: number;
  readonly w: number; // normalized size
  readonly h: number;
}

interface Gray {
  data: Float32Array;
  width: number;
  height: number;
}

const SAMPLE_W = 320; // downscale width for tracking speed

const toGray = (image: ImageData): Gray => {
  const { width, height } = image;
  const img = image.data;
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    data[i] = (img[i * 4]! * 0.299 + img[i * 4 + 1]! * 0.587 + img[i * 4 + 2]! * 0.114) / 255;
  }
  return { data, width, height };
};

const patchAt = (g: Gray, cx: number, cy: number, pw: number, ph: number): Float32Array | null => {
  const x0 = Math.round(cx - pw / 2);
  const y0 = Math.round(cy - ph / 2);
  if (x0 < 0 || y0 < 0 || x0 + pw > g.width || y0 + ph > g.height) return null;
  const out = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      out[y * pw + x] = g.data[(y0 + y) * g.width + (x0 + x)]!;
    }
  }
  return out;
};

const ncc = (a: Float32Array, b: Float32Array): number => {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= a.length;
  mb /= b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]! - ma;
    const bv = b[i]! - mb;
    num += av * bv;
    da += av * av;
    db += bv * bv;
  }
  const denom = Math.sqrt(da * db);
  return denom < 1e-6 ? 0 : num / denom;
};

export const trackRegion = async (
  blob: Blob,
  region: TrackRegion,
  startMs: number,
  endMs: number,
  fps = 5,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<readonly TrackPoint[]> => {
  const step = 1000 / fps;
  const times: number[] = [Math.max(0, startMs)];
  for (let tMs = startMs + step; tMs <= endMs; tMs += step) times.push(tMs);

  // Tracker state survives across streamed frames; frames themselves do not.
  const points: TrackPoint[] = [];
  let template: Float32Array | null = null;
  let cx = 0;
  let cy = 0;
  let pw = 0;
  let ph = 0;
  let searchR = 0;

  await streamFramesAt(
    blob,
    times,
    {
      size: (sourceWidth, sourceHeight) => ({
        width: SAMPLE_W,
        height: Math.round(SAMPLE_W * (sourceHeight / sourceWidth || 0.5625)),
      }),
      ...(signal ? { signal } : {}),
      onProgress: (done, total) => onProgress?.(done / total),
    },
    ({ atMs, image }) => {
      const w = image.width;
      const h = image.height;
      const g = toGray(image);
      if (!template) {
        // Seed the template from the first frame.
        pw = Math.max(8, Math.round(region.w * w));
        ph = Math.max(8, Math.round(region.h * h));
        cx = (region.x + region.w / 2) * w;
        cy = (region.y + region.h / 2) * h;
        searchR = Math.max(8, Math.round(pw * 0.6));
        template = patchAt(g, cx, cy, pw, ph);
        if (template) points.push({ atMs: startMs, x: cx / w, y: cy / h });
        return;
      }
      let best = -2;
      let bx = cx;
      let by = cy;
      for (let dy = -searchR; dy <= searchR; dy += 2) {
        for (let dx = -searchR; dx <= searchR; dx += 2) {
          const cand = patchAt(g, cx + dx, cy + dy, pw, ph);
          if (!cand) continue;
          const score = ncc(template, cand);
          if (score > best) {
            best = score;
            bx = cx + dx;
            by = cy + dy;
          }
        }
      }
      cx = bx;
      cy = by;
      points.push({ atMs, x: cx / w, y: cy / h });

      // Slowly adapt the template to handle gradual appearance changes.
      const refreshed = patchAt(g, cx, cy, pw, ph);
      if (refreshed && best > 0.5) template = refreshed;
    },
  );
  onProgress?.(1);
  return points;
};
