import { audioBlobFor } from "@/media/audio/audio-variant";
import type { RandomAccessMediaSource } from "@/media/source/media-source";
import { resolveMediaSource } from "@/media/source/resolve-media-source";
import { acquireMediaUrl, readMediaFile } from "@/persistence/opfs";
import { sampleFramesAt } from "@/renderer/frame-sampler";
import type { MediaAsset, SourceRotation } from "@movie-desk/core";

// Small-plane frame sampler for analysis. Videos are sampled at a coarse
// interval (~1s) plus short bursts for shake estimation, through the shared
// frame sampler (one WebCodecs pass per run, media-element fallback). Photos
// decode once. Everything renders into a 160×90 canvas — metrics don't need more.

const SAMPLE_W = 160;
const SAMPLE_H = 90;

export interface SampledFrame {
  readonly atMs: number;
  readonly image: ImageData;
}

const canvasCtx = (): CanvasRenderingContext2D => {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable for analysis sampling");
  return ctx;
};

export interface VideoSampleResult {
  readonly frames: readonly SampledFrame[];
  // Bursts of consecutive close frames for shake estimation (3 bursts).
  readonly bursts: readonly (readonly SampledFrame[])[];
}

const acquireVisualSource = async (asset: MediaAsset) => {
  if (asset.proxyPath) {
    const proxy = await acquireMediaUrl(asset.proxyPath);
    if (proxy) return proxy;
  }
  try {
    return await (await resolveMediaSource(asset)).acquirePlaybackUrl();
  } catch {
    return null;
  }
};

// Frame input for the shared sampler: the proxy when it exists (already
// upright), otherwise the original through the source registry so referenced
// files work too. Mirrors acquireVisualSource's proxy → original order.
const acquireVisualInput = async (
  asset: MediaAsset,
): Promise<{ input: Blob | RandomAccessMediaSource; rotation: SourceRotation } | null> => {
  if (asset.proxyPath) {
    const proxy = await readMediaFile(asset.proxyPath);
    if (proxy) return { input: proxy, rotation: 0 };
  }
  try {
    return { input: await resolveMediaSource(asset), rotation: asset.rotation ?? 0 };
  } catch {
    return null;
  }
};

const nonNull = <T>(value: T | null): value is T => value !== null;

export const sampleVideo = async (
  asset: MediaAsset,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<VideoSampleResult | null> => {
  const visual = await acquireVisualInput(asset);
  if (!visual) return null;
  const durMs = asset.durationMs;

  // Coarse pass: ≤ 24 samples, ≥ 500ms apart.
  const count = Math.max(2, Math.min(24, Math.floor(durMs / 1000)));
  const step = durMs / count;
  const coarse = Array.from({ length: count }, (_, i) =>
    Math.max(0, Math.min(durMs - 50, i * step + step / 2)),
  );
  // Shake bursts: 4 frames 120ms apart at 20%/50%/80%.
  const burstTimes = [0.2, 0.5, 0.8].map((frac) => {
    const start = Math.max(0, Math.min(durMs - 600, durMs * frac));
    return Array.from({ length: 4 }, (_, k) => start + k * 120);
  });

  try {
    const sampled = await sampleFramesAt(visual.input, [...coarse, ...burstTimes.flat()], {
      size: { width: SAMPLE_W, height: SAMPLE_H },
      ...(visual.rotation ? { rotation: visual.rotation } : {}),
      ...(signal ? { signal } : {}),
      onProgress: (done, total) => onProgress?.(done / total),
    });
    if (signal?.aborted) return null;
    const byTime = new Map(sampled.map((s) => [s.atMs, s.image]));
    const frameAt = (atMs: number): SampledFrame | null => {
      const image = byTime.get(atMs);
      return image ? { atMs, image } : null;
    };
    const frames = coarse.map(frameAt).filter(nonNull);
    if (frames.length === 0) return null;
    const bursts = burstTimes.map((burst) => burst.map(frameAt).filter(nonNull));
    onProgress?.(1);
    return { frames, bursts };
  } catch {
    return null;
  }
};

export const samplePhoto = async (asset: MediaAsset): Promise<SampledFrame | null> => {
  const lease = await acquireVisualSource(asset);
  if (!lease) return null;
  try {
    const img = new Image();
    img.src = lease.url;
    await img.decode();
    const ctx = canvasCtx();
    ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
    return { atMs: 0, image: ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H) };
  } catch {
    return null;
  } finally {
    lease.release();
  }
};

// Per-second RMS envelope for audio-bearing assets (interest signal). Reads
// the audio-track cache variant (built once at import), never the whole
// original: a 4K HEVC clip is hundreds of MB, its AAC track a few.
export const sampleAudioRms = async (asset: MediaAsset): Promise<readonly number[] | null> => {
  try {
    const blob = await audioBlobFor(asset);
    if (!blob) return null;
    {
      const buf = await blob.arrayBuffer();
      const Ctx = window.OfflineAudioContext ?? window.AudioContext;
      const ctx = new Ctx(1, 44100, 44100) as OfflineAudioContext;
      const audio = await ctx.decodeAudioData(buf);
      const ch = audio.getChannelData(0);
      const perSec = audio.sampleRate;
      const out: number[] = [];
      for (let i = 0; i < ch.length; i += perSec) {
        let sum = 0;
        const end = Math.min(ch.length, i + perSec);
        for (let j = i; j < end; j++) sum += ch[j]! * ch[j]!;
        out.push(Math.sqrt(sum / Math.max(1, end - i)));
      }
      const peak = Math.max(0.0001, ...out);
      return out.map((v) => v / peak);
    }
  } catch {
    return null;
  }
};
