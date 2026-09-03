import { audioBlobFor } from "@/media/audio/audio-variant";
import type { ID, MediaAsset, Project } from "@movie-desk/core";
import {
  type EffectInstance,
  type MediaClip,
  isMediaClip,
  sampleKeyframeTrack,
  sourceOffsetForRamp,
} from "@movie-desk/core";
import { combineInlineStateful } from "./audio-mixer-worker";
import { denoise } from "./spectral-denoise";

const dbToGain = (db: number): number => 10 ** (db / 20);

// Resample one timeline clip into output-rate PCM while following its
// instantaneous speed curve. Accumulating the source cursor makes this O(n);
// repeatedly integrating from the clip start for every sample would be O(n²).
export const resampleClipAudio = (
  source: Float32Array,
  sourceSampleRate: number,
  outputSampleRate: number,
  clip: MediaClip,
): Float32Array => {
  return resampleClipAudioRange(
    source,
    sourceSampleRate,
    outputSampleRate,
    clip,
    0,
    Math.floor((clip.duration / 1000) * outputSampleRate),
  );
};

const resampleClipAudioRange = (
  source: Float32Array,
  sourceSampleRate: number,
  outputSampleRate: number,
  clip: MediaClip,
  clipOffsetMs: number,
  outputSamples: number,
): Float32Array => {
  const output = new Float32Array(outputSamples);
  const speedTrack = clip.keyframes.find((track) => track.target === "speed");
  let sourceCursor =
    ((clip.trimIn + sourceOffsetForRamp(clip, clipOffsetMs)) / 1000) * sourceSampleRate;

  for (let i = 0; i < output.length; i++) {
    const sourceIndex = Math.floor(sourceCursor);
    if (sourceIndex >= 0 && sourceIndex < source.length) output[i] = source[sourceIndex] ?? 0;

    const relMs = clipOffsetMs + (i / outputSampleRate) * 1000;
    const instantaneousRate = speedTrack
      ? Math.max(0.05, sampleKeyframeTrack(speedTrack, relMs) ?? clip.speed)
      : clip.speed;
    sourceCursor += (sourceSampleRate / outputSampleRate) * instantaneousRate;
  }
  return output;
};

// Render a mono buffer through a low-shelf / mid-peaking / high-shelf biquad
// chain using an OfflineAudioContext. Crossover points follow common DAW
// 3-band defaults (≈320 Hz, ≈3.2 kHz).
const applyBiquadEq = async (
  pcm: Float32Array,
  sampleRate: number,
  lowDb: number,
  midDb: number,
  highDb: number,
): Promise<Float32Array> => {
  if (pcm.length === 0) return pcm;
  const ctx = new OfflineAudioContext(1, pcm.length, sampleRate);
  const source = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  // Copy into the channel via a plain (non-shared) typed array to satisfy
  // copyToChannel's ArrayBuffer-backed signature.
  buffer.copyToChannel(Float32Array.from(pcm), 0);
  source.buffer = buffer;

  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 320;
  low.gain.value = lowDb;

  const mid = ctx.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1000;
  mid.Q.value = 0.8;
  mid.gain.value = midDb;

  const high = ctx.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = 3200;
  high.gain.value = highDb;

  source.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(ctx.destination);
  source.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
};

// Per-clip audio effect chain. Gain & fade are cheap in-buffer; EQ uses a
// real biquad render. Returns a fresh buffer; never mutates the input.
const applyAudioEffects = async (
  pcm: Float32Array,
  effects: readonly EffectInstance[],
  sampleRate: number,
  clipOffsetMs: number,
  clipDurationMs: number,
): Promise<Float32Array> => {
  let buf = pcm;
  for (const fx of effects) {
    if (!fx.enabled) continue;
    switch (fx.type) {
      case "audio-gain": {
        const g = dbToGain(Number(fx.params.db ?? 0));
        if (g === 1) break;
        buf = buf.slice();
        for (let i = 0; i < buf.length; i++) buf[i]! *= g;
        break;
      }
      case "audio-fade": {
        const inMs = Number(fx.params.fadeInMs ?? 0);
        const outMs = Number(fx.params.fadeOutMs ?? 0);
        if (inMs === 0 && outMs === 0) break;
        buf = buf.slice();
        for (let i = 0; i < buf.length; i++) {
          const relMs = clipOffsetMs + (i / sampleRate) * 1000;
          const fadeIn = inMs > 0 ? Math.min(1, Math.max(0, relMs / inMs)) : 1;
          const remainingMs = Math.max(0, clipDurationMs - relMs);
          const fadeOut = outMs > 0 ? Math.min(1, remainingMs / outMs) : 1;
          buf[i]! *= Math.min(fadeIn, fadeOut);
        }
        break;
      }
      case "audio-eq": {
        const lowDb = Number(fx.params.low ?? 0);
        const midDb = Number(fx.params.mid ?? 0);
        const highDb = Number(fx.params.high ?? 0);
        if (lowDb === 0 && midDb === 0 && highDb === 0) break;
        buf = await applyBiquadEq(buf, sampleRate, lowDb, midDb, highDb);
        break;
      }
      case "audio-noise-gate": {
        buf = applyNoiseGate(
          buf,
          sampleRate,
          Number(fx.params.thresholdDb ?? -45),
          Number(fx.params.rangeDb ?? -40),
          Number(fx.params.attackMs ?? 5),
          Number(fx.params.releaseMs ?? 120),
        );
        break;
      }
      case "audio-spectral-denoise": {
        buf = denoise(buf, sampleRate, {
          strength: Number(fx.params.strength ?? 1),
          floor: Number(fx.params.floor ?? 0.1),
          noiseEstimateMs: Number(fx.params.noiseEstimateMs ?? 250),
        });
        break;
      }
    }
  }
  return buf;
};

// Envelope-following noise gate. A peak follower drives a gain that opens to
// unity above the threshold and closes to `rangeDb` below it, smoothed by the
// attack (opening) and release (closing) time constants.
export const applyNoiseGate = (
  pcm: Float32Array,
  sampleRate: number,
  thresholdDb: number,
  rangeDb: number,
  attackMs: number,
  releaseMs: number,
): Float32Array => {
  const thr = dbToGain(thresholdDb);
  const closedGain = dbToGain(rangeDb);
  const atkCoef = Math.exp(-1 / Math.max(1, (attackMs / 1000) * sampleRate));
  const relCoef = Math.exp(-1 / Math.max(1, (releaseMs / 1000) * sampleRate));
  const out = pcm.slice();
  let env = 0;
  let gain = closedGain;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]!);
    // Peak follower: instant attack, exponential release on the detector.
    env = a > env ? a : env * relCoef;
    const target = env >= thr ? 1 : closedGain;
    const coef = target > gain ? atkCoef : relCoef;
    gain = target + (gain - target) * coef;
    out[i] = out[i]! * gain;
  }
  return out;
};

export interface DuckingOptions {
  enabled: boolean;
  amountDb: number;
  thresholdDb: number;
}

type StereoChannels = [Float32Array, Float32Array];

export const decodedStereoChannels = (
  buffer: Pick<AudioBuffer, "numberOfChannels" | "getChannelData">,
): readonly [Float32Array, Float32Array] => {
  const left = buffer.getChannelData(0);
  return [left, buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left];
};

export const packStereoPlanar = (
  channels: readonly [Float32Array, Float32Array],
  from: number,
  numberOfFrames: number,
): Float32Array<ArrayBuffer> => {
  const planar: Float32Array<ArrayBuffer> = new Float32Array(numberOfFrames * 2);
  planar.set(channels[0].subarray(from, from + numberOfFrames));
  planar.set(channels[1].subarray(from, from + numberOfFrames), numberOfFrames);
  return planar;
};

export interface AudioMixChunk {
  readonly channels: StereoChannels;
  readonly sampleRate: number;
  readonly startSample: number;
}

export interface AudioMixOptions {
  readonly startMs?: number;
  readonly endMs?: number;
  readonly chunkDurationMs?: number;
  readonly signal?: AbortSignal;
}

interface PreparedClip {
  readonly clip: MediaClip;
  readonly bus: "voice" | "music";
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException("Audio mixing cancelled", "AbortError");
};

// Chunked project mixer. Only four bus chunks plus two output chunks are ever
// allocated, independent of timeline duration. Decoded source assets use a
// small LRU because decodeAudioData itself is whole-file; this bounds retained
// source memory while avoiding a decode of every project asset up front.
export class ProjectAudioMixer {
  readonly sampleRate = 48_000;
  private static readonly DEFAULT_CHUNK_MS = 30_000;
  private static readonly EFFECT_PADDING_MS = 500;
  private static readonly MAX_DECODED_ASSETS = 2;
  private readonly clips: PreparedClip[];
  private readonly buffers = new Map<string, AudioBuffer | null>();
  private decodeContext: OfflineAudioContext | null = null;

  constructor(
    private readonly project: Project,
    private readonly getAsset: (id: ID) => MediaAsset | undefined,
    private readonly ducking?: DuckingOptions,
  ) {
    const soloing = project.timeline.tracks.some((track) => track.solo);
    this.clips = project.timeline.tracks.flatMap((track) => {
      if (track.muted || (soloing && !track.solo)) return [];
      const bus = track.kind === "audio" ? "music" : "voice";
      return track.clips
        .filter((clip): clip is MediaClip => isMediaClip(clip) && !clip.disabled)
        .map((clip) => ({ clip, bus }));
    });
  }

  async *chunks(options: AudioMixOptions = {}): AsyncGenerator<AudioMixChunk> {
    const rangeStartMs = Math.max(0, options.startMs ?? 0);
    const rangeEndMs = Math.max(
      rangeStartMs,
      Math.min(this.project.timeline.duration, options.endMs ?? this.project.timeline.duration),
    );
    const absoluteStartSample = Math.floor((rangeStartMs / 1000) * this.sampleRate);
    const absoluteEndSample = Math.ceil((rangeEndMs / 1000) * this.sampleRate);
    const chunkSamples = Math.max(
      1,
      Math.floor(
        ((options.chunkDurationMs ?? ProjectAudioMixer.DEFAULT_CHUNK_MS) / 1000) * this.sampleRate,
      ),
    );
    let duckGain = 1;

    for (
      let chunkStartSample = absoluteStartSample;
      chunkStartSample < absoluteEndSample;
      chunkStartSample += chunkSamples
    ) {
      throwIfAborted(options.signal);
      const chunkEndSample = Math.min(absoluteEndSample, chunkStartSample + chunkSamples);
      const length = chunkEndSample - chunkStartSample;
      const voiceChannels: StereoChannels = [new Float32Array(length), new Float32Array(length)];
      const musicChannels: StereoChannels = [new Float32Array(length), new Float32Array(length)];

      for (const { clip, bus } of this.clips) {
        const clipStartSample = Math.floor((clip.start / 1000) * this.sampleRate);
        const clipEndSample = Math.ceil(((clip.start + clip.duration) / 1000) * this.sampleRate);
        const overlapStart = Math.max(chunkStartSample, clipStartSample);
        const overlapEnd = Math.min(chunkEndSample, clipEndSample);
        if (overlapEnd <= overlapStart) continue;
        throwIfAborted(options.signal);

        const asset = this.getAsset(clip.assetId);
        if (!asset || (asset.kind !== "video" && asset.kind !== "audio")) continue;
        const decoded = await this.bufferFor(asset, options.signal);
        if (!decoded) continue;

        const effectPaddingSamples = clip.effects.length
          ? Math.floor((ProjectAudioMixer.EFFECT_PADDING_MS / 1000) * this.sampleRate)
          : 0;
        const processStart = Math.max(clipStartSample, overlapStart - effectPaddingSamples);
        const processEnd = Math.min(clipEndSample, overlapEnd + effectPaddingSamples);
        const outputSamples = processEnd - processStart;
        const clipOffsetMs = ((processStart - clipStartSample) / this.sampleRate) * 1000;
        const [leftSource, rightSource] = decodedStereoChannels(decoded);
        const processed = await Promise.all(
          [leftSource, rightSource].map((source) =>
            applyAudioEffects(
              resampleClipAudioRange(
                source,
                decoded.sampleRate,
                this.sampleRate,
                clip,
                clipOffsetMs,
                outputSamples,
              ),
              clip.effects,
              this.sampleRate,
              clipOffsetMs,
              clip.duration,
            ),
          ),
        );
        throwIfAborted(options.signal);

        const volumeTrack = clip.keyframes.find((track) => track.target === "volume");
        const baseVolume = clip.volume ?? 1;
        if (volumeTrack || baseVolume !== 1) {
          for (const channel of processed) {
            for (let i = 0; i < channel.length; i++) {
              const relativeMs = clipOffsetMs + (i / this.sampleRate) * 1000;
              const volume = volumeTrack
                ? (sampleKeyframeTrack(volumeTrack, relativeMs) ?? baseVolume)
                : baseVolume;
              channel[i] = channel[i]! * volume;
            }
          }
        }

        const target = bus === "music" ? musicChannels : voiceChannels;
        const targetOffset = overlapStart - chunkStartSample;
        const processedOffset = overlapStart - processStart;
        const mixedSamples = overlapEnd - overlapStart;
        for (let channel = 0; channel < 2; channel++) {
          const input = processed[channel]!.subarray(
            processedOffset,
            processedOffset + mixedSamples,
          );
          const output = target[channel]!;
          for (let i = 0; i < input.length; i++) output[targetOffset + i]! += input[i] ?? 0;
        }
      }

      const combined = await runCombineWorker(
        {
          voiceChannels,
          musicChannels,
          sampleRate: this.sampleRate,
          initialDuckGain: duckGain,
          ...(this.ducking ? { ducking: this.ducking } : {}),
        },
        options.signal,
      );
      duckGain = combined.finalDuckGain;
      throwIfAborted(options.signal);
      yield {
        channels: combined.channels,
        sampleRate: this.sampleRate,
        startSample: chunkStartSample - absoluteStartSample,
      };
    }
  }

  dispose(): void {
    this.buffers.clear();
    this.decodeContext = null;
  }

  private async bufferFor(asset: MediaAsset, signal?: AbortSignal): Promise<AudioBuffer | null> {
    if (this.buffers.has(asset.id)) {
      const cached = this.buffers.get(asset.id) ?? null;
      this.buffers.delete(asset.id);
      this.buffers.set(asset.id, cached);
      return cached;
    }
    throwIfAborted(signal);
    const blob = await audioBlobFor(asset);
    if (!blob) return null;
    let decoded: AudioBuffer | null = null;
    try {
      this.decodeContext ??= new OfflineAudioContext(1, 1, this.sampleRate);
      decoded = await this.decodeContext.decodeAudioData(await blob.arrayBuffer());
    } catch {
      // Video without an audio stream and unsupported codecs are valid inputs;
      // they simply contribute no PCM to the mix.
    }
    throwIfAborted(signal);
    this.buffers.set(asset.id, decoded);
    while (this.buffers.size > ProjectAudioMixer.MAX_DECODED_ASSETS) {
      const oldest = this.buffers.keys().next().value;
      if (oldest === undefined) break;
      this.buffers.delete(oldest);
    }
    return decoded;
  }
}

// Cached worker — created once on first export and reused across runs.
let mixerWorker: Worker | null = null;
let mixerRequestId = 0;
// A worker that never answers (bundler bootstrap that cannot run, blocked
// blob: URL, crashed thread) would otherwise hang the export forever. After
// one silent timeout the mixer runs the combine inline for the rest of the
// session. Combining a chunk is well under a millisecond of work.
const WORKER_REPLY_TIMEOUT_MS = 5_000;
let workerBroken = false;

const getWorker = (): Worker | null => {
  if (typeof Worker === "undefined" || workerBroken) return null;
  if (mixerWorker) return mixerWorker;
  try {
    // A classic worker: the dev bundler's worker bootstrap uses importScripts,
    // which a module worker does not have, and the production bundler handles
    // both kinds.
    mixerWorker = new Worker(new URL("./audio-mixer-worker.ts", import.meta.url));
    return mixerWorker;
  } catch {
    return null;
  }
};

const abandonWorker = (): void => {
  workerBroken = true;
  mixerWorker?.terminate();
  mixerWorker = null;
};

interface CombineRequest {
  voiceChannels: StereoChannels;
  musicChannels: StereoChannels;
  sampleRate: number;
  initialDuckGain?: number;
  ducking?: { enabled: boolean; amountDb: number; thresholdDb: number };
}

const runCombineWorker = async (
  req: CombineRequest,
  signal?: AbortSignal,
): Promise<{ channels: StereoChannels; finalDuckGain: number }> => {
  const w = getWorker();
  if (!w) {
    // Tests / SSR / browsers without Worker / a worker given up on — run inline.
    return combineInlineStateful(req);
  }
  // The buffers are transferred to the worker; keep copies so a timeout can
  // still be served inline.
  const retained: CombineRequest = {
    ...req,
    voiceChannels: [req.voiceChannels[0].slice(), req.voiceChannels[1].slice()],
    musicChannels: [req.musicChannels[0].slice(), req.musicChannels[1].slice()],
  };
  return new Promise<{ channels: StereoChannels; finalDuckGain: number }>((resolve, reject) => {
    const requestId = ++mixerRequestId;
    const cleanup = () => {
      clearTimeout(timer);
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onMessage = (
      e: MessageEvent<{
        requestId?: number;
        channels: StereoChannels;
        finalDuckGain: number;
      }>,
    ) => {
      if (e.data.requestId !== requestId) return;
      cleanup();
      resolve({ channels: e.data.channels, finalDuckGain: e.data.finalDuckGain });
    };
    const onError = (err: ErrorEvent) => {
      cleanup();
      abandonWorker();
      resolve(combineInlineStateful(retained));
      void err;
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Audio mixing cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      abandonWorker();
      resolve(combineInlineStateful(retained));
    }, WORKER_REPLY_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ ...req, requestId }, [
      req.voiceChannels[0].buffer,
      req.voiceChannels[1].buffer,
      req.musicChannels[0].buffer,
      req.musicChannels[1].buffer,
    ]);
  });
};
