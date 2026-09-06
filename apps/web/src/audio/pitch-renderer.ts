import type { MediaClip, StretchRequest } from "@movie-desk/core";

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

// One worker per job makes cancellation/error isolation explicit. Only one job
// is admitted at a time; callers never queue unbounded cloned PCM.
let queue: Promise<unknown> = Promise.resolve();
export const pitchMainSlice = <T>(run: () => T): T => {
  const start = performance.now();
  try {
    return run();
  } finally {
    performance.measure("pitch-main-slice", { start });
    performance.clearMeasures("pitch-main-slice");
  }
};
const yieldMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export const renderPitchInWorker = (
  req: StretchRequest,
  signal?: AbortSignal,
): Promise<Float32Array[]> => {
  const run = async () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const channels: Float32Array[] = [];
    // Copy in bounded blocks and transfer ownership, never detach decoded PCM.
    for (const source of req.channels) {
      const copy = pitchMainSlice(() => new Float32Array(source.length));
      for (let at = 0; at < source.length; at += 65536) {
        pitchMainSlice(() => copy.set(source.subarray(at, at + 65536), at));
        if (at % 524288 === 0) await yieldMain();
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      }
      channels.push(copy);
    }
    return new Promise<Float32Array[]>((resolve, reject) => {
      const worker = new Worker(new URL("./pitch-worker.ts", import.meta.url));
      const cleanup = () => {
        clearTimeout(timer);
        worker.terminate();
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Pitch render timed out"));
      }, 30000);
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event: MessageEvent<{ channels: Float32Array[]; error?: string }>) => {
        cleanup();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.channels);
      };
      worker.onerror = () => {
        cleanup();
        reject(new Error("Pitch worker failed"));
      };
      worker.postMessage(
        { ...req, channels, id: 1 },
        channels.map((c) => c.buffer),
      );
    });
  };
  const result = queue.then(run);
  queue = result.catch(() => {});
  return result;
};
