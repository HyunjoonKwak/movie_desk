import type { MediaAsset } from "@movie-desk/core";
import { acquireMediaUrl } from "@/persistence/opfs";
import { resolveMediaSource } from "@/media/source/resolve-media-source";

// Small-plane frame sampler for analysis. Videos are seeked at a coarse
// interval (~1s), plus short bursts for shake estimation. Photos decode once.
// Everything renders into a 160×90 canvas — metrics don't need more.

export const SAMPLE_W = 160;
export const SAMPLE_H = 90;

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

const seekTo = (video: HTMLVideoElement, sec: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("seek failed"));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = sec;
  });

const loadVideo = (url: string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.src = url;
    const onMeta = () => {
      cleanup();
      resolve(v);
    };
    const onError = () => {
      cleanup();
      reject(new Error("video metadata load failed"));
    };
    const cleanup = () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("error", onError);
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("error", onError);
  });

const teardown = (v: HTMLVideoElement) => {
  v.pause();
  v.removeAttribute("src");
  v.load();
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

export const sampleVideo = async (
  asset: MediaAsset,
  onProgress?: (p: number) => void,
): Promise<VideoSampleResult | null> => {
  const lease = await acquireVisualSource(asset);
  if (!lease) return null;
  try {
    const video = await loadVideo(lease.url);
    try {
      const durMs = (video.duration || asset.durationMs / 1000) * 1000;
      const ctx = canvasCtx();
      const grab = (atMs: number): SampledFrame => {
        ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
        return { atMs, image: ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H) };
      };

      // Coarse pass: ≤ 24 samples, ≥ 500ms apart.
      const count = Math.max(2, Math.min(24, Math.floor(durMs / 1000)));
      const step = durMs / count;
      const frames: SampledFrame[] = [];
      for (let i = 0; i < count; i++) {
        const atMs = Math.min(durMs - 50, i * step + step / 2);
        await seekTo(video, atMs / 1000);
        frames.push(grab(atMs));
        onProgress?.((i + 1) / (count + 4));
      }

      // Shake bursts: 4 frames 120ms apart at 20%/50%/80%.
      const bursts: SampledFrame[][] = [];
      for (const frac of [0.2, 0.5, 0.8]) {
        const start = Math.max(0, Math.min(durMs - 600, durMs * frac));
        const burst: SampledFrame[] = [];
        for (let k = 0; k < 4; k++) {
          const atMs = start + k * 120;
          await seekTo(video, atMs / 1000);
          burst.push(grab(atMs));
        }
        bursts.push(burst);
      }
      onProgress?.(1);
      return { frames, bursts };
    } finally {
      teardown(video);
    }
  } catch {
    return null;
  } finally {
    lease.release();
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

// Per-second RMS envelope for audio-bearing assets (interest signal).
export const sampleAudioRms = async (asset: MediaAsset): Promise<readonly number[] | null> => {
  try {
    const lease = await acquireMediaUrl(asset.opfsPath);
    if (!lease) return null;
    try {
      const resp = await fetch(lease.url);
      const buf = await resp.arrayBuffer();
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
    } finally {
      lease.release();
    }
  } catch {
    return null;
  }
};
