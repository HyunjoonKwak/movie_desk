// WebCodecs frame provider backed by range-based demuxing. A cache miss
// requests a small window around the playhead; callers use the <video> fallback
// while that asynchronous range is being decoded.

import type { RandomAccessMediaSource } from "@/media/source/media-source";
import { type DecoderHandle, UnsupportedCodecError, decodeMp4ToCache } from "./mp4-decoder";
import { VideoFrameCache } from "./video-frame-cache";

const isWebCodecsAvailable = (): boolean =>
  typeof window !== "undefined" && "VideoDecoder" in window;

// A cached frame is only trusted if it's within this window of the requested
// time. Beyond it we return null so the compositor seeks a real <video>
// instead of showing a far-off cached frame (the cache is a small per-asset LRU).
const FRAME_TOLERANCE_US = 100_000; // 100ms

// Every prepared asset keeps a demuxer (with its read cache) and decoder
// state alive. Scrubbing through a large library must not accumulate them,
// so only the most recently used handles stay open; an evicted asset is
// simply prepared again the next time a clip of it is rendered.
const MAX_DECODER_HANDLES = 8;

export interface FrameProvider {
  framesFor(assetId: string, atMs: number): VideoFrame | null;
  prepare(assetId: string, source: Blob | RandomAccessMediaSource): Promise<boolean>;
  // Whether frames can currently be served or are being prepared.
  has(assetId: string): boolean;
  retain(assetIds: ReadonlySet<string>): void;
  forget(assetId: string): void;
  dispose(): void;
}

class CachingFrameProvider implements FrameProvider {
  private readonly cache = new VideoFrameCache();
  // Insertion order doubles as recency: touched handles move to the end.
  private readonly handles = new Map<string, DecoderHandle>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly epochs = new Map<string, number>();
  private readonly unsupported = new Set<string>();
  private disposed = false;

  constructor(private readonly maxHandles = MAX_DECODER_HANDLES) {}

  framesFor(assetId: string, atMs: number): VideoFrame | null {
    const handle = this.touch(assetId);
    const f = this.cache.nearest(assetId, Math.round(atMs * 1000), FRAME_TOLERANCE_US);
    if (!f) void handle?.request(Math.round(atMs * 1000));
    return f ? f.frame : null;
  }

  has(assetId: string): boolean {
    return this.handles.has(assetId) || this.pending.has(assetId);
  }

  private touch(assetId: string): DecoderHandle | undefined {
    const handle = this.handles.get(assetId);
    if (handle) {
      this.handles.delete(assetId);
      this.handles.set(assetId, handle);
    }
    return handle;
  }

  private evictBeyondLimit(): void {
    for (const assetId of this.handles.keys()) {
      if (this.handles.size <= this.maxHandles) return;
      this.forget(assetId);
    }
  }

  async prepare(assetId: string, source: Blob | RandomAccessMediaSource): Promise<boolean> {
    if (this.disposed || !isWebCodecsAvailable()) return false;
    if (this.touch(assetId)) return true;
    if (this.unsupported.has(assetId)) return false;
    const inflight = this.pending.get(assetId);
    if (inflight) return inflight;

    const epoch = this.epochs.get(assetId) ?? 0;
    const job = (async (): Promise<boolean> => {
      try {
        const handle = await decodeMp4ToCache(source, assetId, this.cache);
        if (!handle) return false;
        if (this.disposed || (this.epochs.get(assetId) ?? 0) !== epoch) {
          handle.close();
          return false;
        }
        this.handles.set(assetId, handle);
        this.evictBeyondLimit();
        return true;
      } catch (error) {
        if (error instanceof UnsupportedCodecError) this.unsupported.add(assetId);
        return false;
      } finally {
        this.pending.delete(assetId);
      }
    })();
    this.pending.set(assetId, job);
    return job;
  }

  retain(assetIds: ReadonlySet<string>) {
    const knownIds = new Set([...this.handles.keys(), ...this.pending.keys()]);
    for (const assetId of knownIds) {
      if (!assetIds.has(assetId)) this.forget(assetId);
    }
  }

  forget(assetId: string) {
    this.epochs.set(assetId, (this.epochs.get(assetId) ?? 0) + 1);
    this.cache.forget(assetId);
    this.handles.get(assetId)?.close();
    this.handles.delete(assetId);
  }

  dispose() {
    this.disposed = true;
    for (const h of this.handles.values()) h.close();
    this.handles.clear();
    this.pending.clear();
    this.cache.clear();
  }
}

let singleton: FrameProvider | null = null;

export const getFrameProvider = (): FrameProvider => {
  if (!singleton) singleton = new CachingFrameProvider();
  return singleton;
};

export const createFrameProviderForTests = (maxHandles: number): FrameProvider =>
  new CachingFrameProvider(maxHandles);
