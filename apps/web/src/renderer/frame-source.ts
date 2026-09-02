import { useProxyStore } from "@/media/proxy-store";
import type { PlaybackLease, RandomAccessMediaSource } from "@/media/source/media-source";
import { resolveMediaSource } from "@/media/source/resolve-media-source";
import { acquireMediaUrl } from "@/persistence/opfs";
import type { MediaAsset } from "@movie-desk/core";
import { BoundedResourceCache } from "./bounded-resource-cache";

type Source = HTMLVideoElement | HTMLImageElement;
const mediaUrlLeases = new WeakMap<Source, PlaybackLease>();

interface FrameSourceLeaseDependencies {
  readonly acquireProxy: (key: string) => Promise<PlaybackLease | null>;
  readonly resolveSource: (asset: MediaAsset) => Promise<RandomAccessMediaSource>;
}

const defaultLeaseDependencies: FrameSourceLeaseDependencies = {
  acquireProxy: acquireMediaUrl,
  resolveSource: resolveMediaSource,
};

// Proxies remain rebuildable OPFS entries. Originals go through the common
// source resolver so referenced disk images and codecs that fall back from
// WebCodecs receive the same revocable playback URL as the decoder path.
export const acquireFrameSourceLease = async (
  asset: MediaAsset,
  useProxy: boolean,
  dependencies: FrameSourceLeaseDependencies = defaultLeaseDependencies,
): Promise<PlaybackLease | null> => {
  if (useProxy && asset.proxyPath) {
    const proxy = await dependencies.acquireProxy(asset.proxyPath);
    if (proxy) return proxy;
  }
  try {
    return await (await dependencies.resolveSource(asset)).acquirePlaybackUrl();
  } catch {
    return null;
  }
};

const releaseSource = (source: Source): void => {
  if (source instanceof HTMLVideoElement) {
    source.pause();
    source.removeAttribute("src");
    source.load();
  } else {
    source.removeAttribute("src");
  }
  mediaUrlLeases.get(source)?.release();
  mediaUrlLeases.delete(source);
};

// Bounded fallback element cache. WebCodecs handles frame-accurate video
// decoding where available; these elements remain necessary for images,
// unsupported codecs, and browsers without WebCodecs.
export class FrameSourcePool {
  private static readonly MAX_SOURCES = 12;
  private readonly cache = new BoundedResourceCache<string, Source>(
    FrameSourcePool.MAX_SOURCES,
    releaseSource,
  );
  private readonly pending = new Map<string, Promise<Source | null>>();
  private readonly retryAt = new Map<string, number>();
  private retainedIds: ReadonlySet<string> | null = null;

  retain(assetIds: ReadonlySet<string>): void {
    this.retainedIds = assetIds;
    this.cache.retain(assetIds);
    for (const id of this.retryAt.keys()) if (!assetIds.has(id)) this.retryAt.delete(id);
  }

  async get(asset: MediaAsset): Promise<Source | null> {
    if (this.retainedIds && !this.retainedIds.has(asset.id)) return null;
    const cached = this.cache.get(asset.id);
    if (cached) return cached;
    if ((this.retryAt.get(asset.id) ?? 0) > Date.now()) return null;
    const inflight = this.pending.get(asset.id);
    if (inflight) return inflight;
    const promise = this.load(asset);
    this.pending.set(asset.id, promise);
    let loaded: Source | null = null;
    try {
      loaded = await promise;
    } catch {
      loaded = null;
    } finally {
      if (this.pending.get(asset.id) === promise) this.pending.delete(asset.id);
    }
    if (loaded) {
      if (!this.retainedIds || this.retainedIds.has(asset.id)) {
        this.cache.set(asset.id, loaded);
        this.retryAt.delete(asset.id);
      } else {
        releaseSource(loaded);
        loaded = null;
      }
    } else {
      // Asset metadata can be restored before its file is readable (an import
      // still writing to OPFS).
      // Retry with a small backoff instead of permanently caching the miss or
      // probing OPFS on every animation frame.
      this.retryAt.set(asset.id, Date.now() + 1000);
    }
    return loaded;
  }

  private async load(asset: MediaAsset): Promise<Source | null> {
    // Use the low-res proxy for preview/scrub when enabled and available.
    const useProxy = useProxyStore.getState().useProxy;
    const lease = await acquireFrameSourceLease(asset, useProxy);
    if (!lease) return null;
    let source: Source | null = null;
    if (asset.kind === "image") {
      source = await new Promise<Source | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = lease.url;
      });
    } else if (asset.kind === "video") {
      source = await new Promise<Source | null>((resolve) => {
        const v = document.createElement("video");
        v.crossOrigin = "anonymous";
        v.preload = "auto";
        v.muted = true;
        v.playsInline = true;
        v.onloadeddata = () => resolve(v);
        v.onerror = () => resolve(null);
        v.src = lease.url;
      });
    }
    if (!source) {
      lease.release();
      return null;
    }
    mediaUrlLeases.set(source, lease);
    return source;
  }

  dispose() {
    this.cache.clear();
    this.pending.clear();
    this.retryAt.clear();
    this.retainedIds = null;
  }
}
