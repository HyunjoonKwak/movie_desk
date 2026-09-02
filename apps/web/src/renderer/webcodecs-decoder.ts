// WebCodecs frame provider backed by range-based mp4box demuxing. A cache miss
// requests a small window around the playhead; callers use the <video> fallback
// while that asynchronous range is being decoded.

import type { RandomAccessMediaSource } from "@/media/source/media-source";
import { type DecoderHandle, decodeMp4ToCache } from "./mp4-decoder";
import { VideoFrameCache } from "./video-frame-cache";

const isWebCodecsAvailable = (): boolean =>
  typeof window !== "undefined" && "VideoDecoder" in window;

// A cached frame is only trusted if it's within this window of the requested
// time. Beyond it we return null so the compositor seeks a real <video>
// instead of showing a far-off cached frame (the cache is a small per-asset LRU).
const FRAME_TOLERANCE_US = 100_000; // 100ms

export interface FrameProvider {
  framesFor(assetId: string, atMs: number): VideoFrame | null;
  prepare(assetId: string, source: Blob | RandomAccessMediaSource): Promise<boolean>;
  retain(assetIds: ReadonlySet<string>): void;
  forget(assetId: string): void;
  dispose(): void;
}

class CachingFrameProvider implements FrameProvider {
  private readonly cache = new VideoFrameCache();
  private readonly handles = new Map<string, DecoderHandle>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly epochs = new Map<string, number>();
  private disposed = false;

  framesFor(assetId: string, atMs: number): VideoFrame | null {
    const f = this.cache.nearest(assetId, Math.round(atMs * 1000), FRAME_TOLERANCE_US);
    if (!f) void this.handles.get(assetId)?.request(Math.round(atMs * 1000));
    return f ? f.frame : null;
  }

  async prepare(assetId: string, source: Blob | RandomAccessMediaSource): Promise<boolean> {
    if (this.disposed || !isWebCodecsAvailable()) return false;
    if (this.handles.has(assetId)) return true;
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
        return true;
      } catch {
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
