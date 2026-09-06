import {
  type MediaClip,
  type StretchResult,
  type StretchRequest,
  type Track,
  isMediaClip,
  sourceOffsetForRamp,
} from "@movie-desk/core";

export const PITCH_CACHE_BYTES = 128 * 1024 * 1024;
export const pitchCacheKey = (clip: MediaClip, sampleRate: number, revision = 0): string =>
  JSON.stringify([
    clip.assetId,
    revision,
    sampleRate,
    clip.trimIn,
    clip.trimOut,
    clip.duration,
    clip.speed,
    clip.preservePitch === true,
    clip.keyframes.filter((t) => t.target === "speed"),
  ]);

// Ignore visual edits and playhead ticks; restart scheduled audio only when
// its timeline mapping changes. Precision gestures notify after commit/cancel.
export const pitchPlaybackKey = (tracks: readonly Track[]): string =>
  JSON.stringify(
    tracks.map((track) => [
      track.id,
      track.muted,
      track.solo,
      track.clips
        .filter(isMediaClip)
        .map((clip) => [clip.id, clip.start, clip.disabled, pitchCacheKey(clip, 0)]),
    ]),
  );

export class PitchCache<T> {
  private entries = new Map<string, { value: T; bytes: number; assetId: string }>();
  bytes = 0;
  constructor(readonly limit = PITCH_CACHE_BYTES) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, bytes: number, assetId: string): void {
    this.delete(key);
    if (bytes > this.limit) return;
    while (this.bytes + bytes > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.entries.set(key, { value, bytes, assetId });
    this.bytes += bytes;
  }
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
  retain(assetIds: ReadonlySet<string>): void {
    for (const [key, entry] of this.entries) if (!assetIds.has(entry.assetId)) this.delete(key);
  }
  forget(assetId: string): void {
    for (const [key, entry] of this.entries) if (entry.assetId === assetId) this.delete(key);
  }
}

// At most two job slots share reusable workers. Aborts discard busy workers.
const idleWorkers: Worker[] = [];
let workerGeneration = 0;
export const disposePitchWorkers = (): void => {
  workerGeneration++;
  for (const worker of idleWorkers.splice(0)) worker.terminate();
};

export const pitchMainSlice = <T>(run: () => T): T => {
  if (process.env.NODE_ENV === "production") return run();
  const start = performance.now();
  try {
    return run();
  } finally {
    performance.measure("pitch-main-slice", { start });
    performance.clearMeasures("pitch-main-slice");
  }
};
// Bound concurrent source copies while allowing independent visible clips to
// render. Aborted waiters leave the queue before allocating PCM.
let activeJobs = 0;
const waiting: (() => void)[] = [];
const acquireJob = (signal?: AbortSignal): Promise<() => void> =>
  new Promise((resolve, reject) => {
    const abort = () => {
      const index = waiting.indexOf(start);
      if (index >= 0) waiting.splice(index, 1);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const start = () => {
      signal?.removeEventListener("abort", abort);
      activeJobs++;
      resolve(() => {
        activeJobs--;
        waiting.shift()?.();
      });
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    if (activeJobs < 2) start();
    else {
      waiting.push(start);
      signal?.addEventListener("abort", abort, { once: true });
    }
  });

export const pitchSourceWindow = (
  req: Pick<
    StretchRequest,
    "clip" | "offsetMs" | "outputSamples" | "sourceSampleRate" | "outputSampleRate"
  >,
): { lower: number; upper: number } => {
  // Four pre-roll hops, overlap window and search margin in source time.
  const marginMs = 250;
  const lower = Math.max(
    0,
    Math.floor(
      ((req.clip.trimIn +
        sourceOffsetForRamp(req.clip, Math.max(0, req.offsetMs - marginMs)) -
        marginMs) *
        req.sourceSampleRate) /
        1000,
    ),
  );
  const upper = Math.ceil(
    ((req.clip.trimIn +
      sourceOffsetForRamp(
        req.clip,
        req.offsetMs + (req.outputSamples * 1000) / req.outputSampleRate + marginMs,
      ) +
      marginMs) *
      req.sourceSampleRate) /
      1000,
  );
  return { lower, upper };
};

const yieldMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export const renderPitchRangeInWorker = (
  req: StretchRequest,
  signal?: AbortSignal,
): Promise<StretchResult> => {
  const run = async () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (typeof Worker === "undefined") throw new Error("Pitch worker unavailable");
    const { lower, upper } = pitchSourceWindow(req);
    const channels: Float32Array[] = [];
    // Copy in bounded blocks and transfer ownership, never detach decoded PCM.
    for (const original of req.channels) {
      const source = original.subarray(lower, upper);
      const copy = pitchMainSlice(() => new Float32Array(source.length));
      for (let at = 0; at < source.length; at += 65536) {
        pitchMainSlice(() => copy.set(source.subarray(at, at + 65536), at));
        if (at % 524288 === 0) await yieldMain();
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      }
      channels.push(copy);
    }
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return new Promise<StretchResult>((resolve, reject) => {
      const worker = idleWorkers.pop() ?? new Worker(new URL("./pitch-worker.ts", import.meta.url));
      const generation = workerGeneration;
      const cleanup = (discard = false) => {
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        if (discard || generation !== workerGeneration) worker.terminate();
        else idleWorkers.push(worker);
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup(true);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const timer = setTimeout(() => {
        cleanup(true);
        reject(new Error("Pitch render timed out"));
      }, 30000);
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event: MessageEvent<StretchResult & { error?: string }>) => {
        cleanup(Boolean(event.data.error));
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data);
      };
      worker.onerror = () => {
        cleanup(true);
        reject(new Error("Pitch worker failed"));
      };
      try {
        worker.postMessage(
          { ...req, channels, sourceStartSample: lower },
          channels.map((c) => c.buffer),
        );
      } catch (error) {
        cleanup(true);
        reject(error);
      }
    });
  };
  return (async () => {
    const release = await acquireJob(signal);
    try {
      return await run();
    } finally {
      release();
    }
  })();
};

// Preview is stateless; export callers explicitly own their continuation.
export const renderPitchInWorker = async (
  req: StretchRequest,
  signal?: AbortSignal,
): Promise<Float32Array[]> => (await renderPitchRangeInWorker(req, signal)).channels;
