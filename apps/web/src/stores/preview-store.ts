import { reloadSpan } from "@/lib/reload-metrics";
import {
  type AssetPreviews,
  type Filmstrip,
  getFilmstrips,
  getThumbs,
  getWaveforms,
  onPreviewsStored,
} from "@/persistence/previews";
import type { MediaAsset } from "@movie-desk/core";
import { type RefObject, useEffect, useMemo, useState } from "react";
import { create } from "zustand";

// In-memory previews for the session. Thumbnails are small and kept for
// every asset asked for; filmstrips are loaded only for the assets the
// timeline or the range editor shows. Requests are batched into one
// database read per tick, so a thousand cards mounting cost one query.
interface PreviewState {
  readonly thumbs: Readonly<Record<string, string>>;
  readonly filmstrips: Readonly<Record<string, Filmstrip>>;
  readonly waveforms: Readonly<Record<string, readonly number[]>>;
  remember: (assetId: string, previews: AssetPreviews, replaceMissing?: boolean) => void;
  forget: (assetIds: readonly string[]) => void;
  clear: () => void;
}

const MAX_FILMSTRIPS = 200;
const MAX_WAVEFORMS = 200;
const filmstripOrder: string[] = [];
const retainedFilmstrips = new Map<string, number>();
const waveformOrder: string[] = [];
const retainedWaveforms = new Map<string, number>();
const askedThumbs = new Set<string>();
const askedFilmstrips = new Set<string>();
const askedWaveforms = new Set<string>();
let previewGeneration = 0;
const evictOverflow = <T>(
  values: Record<string, T>,
  order: string[],
  retained: ReadonlyMap<string, number>,
  asked: Set<string>,
  limit: number,
): string[] => {
  const evictedIds: string[] = [];
  let candidates = order.length;
  while (order.length > limit && candidates > 0) {
    candidates--;
    const evicted = order.shift();
    if (!evicted) break;
    if (retained.has(evicted)) {
      order.push(evicted);
      continue;
    }
    delete values[evicted];
    asked.delete(evicted);
    evictedIds.push(evicted);
  }
  return evictedIds;
};

const touchFilmstrip = (assetId: string, filmstrips: Record<string, Filmstrip>): void => {
  const prior = filmstripOrder.indexOf(assetId);
  if (prior >= 0) filmstripOrder.splice(prior, 1);
  filmstripOrder.push(assetId);
  evictOverflow(filmstrips, filmstripOrder, retainedFilmstrips, askedFilmstrips, MAX_FILMSTRIPS);
};

const touchWaveform = (assetId: string, waveforms: Record<string, readonly number[]>): void => {
  const prior = waveformOrder.indexOf(assetId);
  if (prior >= 0) waveformOrder.splice(prior, 1);
  waveformOrder.push(assetId);
  evictOverflow(waveforms, waveformOrder, retainedWaveforms, askedWaveforms, MAX_WAVEFORMS);
};

const pruneFilmstrips = (): void => {
  if (filmstripOrder.length <= MAX_FILMSTRIPS) return;
  const filmstrips = { ...usePreviewStore.getState().filmstrips };
  const evicted = evictOverflow(
    filmstrips,
    filmstripOrder,
    retainedFilmstrips,
    askedFilmstrips,
    MAX_FILMSTRIPS,
  );
  if (evicted.length > 0) usePreviewStore.setState({ filmstrips });
};

const pruneWaveforms = (): void => {
  if (waveformOrder.length <= MAX_WAVEFORMS) return;
  const waveforms = { ...usePreviewStore.getState().waveforms };
  const evicted = evictOverflow(
    waveforms,
    waveformOrder,
    retainedWaveforms,
    askedWaveforms,
    MAX_WAVEFORMS,
  );
  if (evicted.length > 0) usePreviewStore.setState({ waveforms });
};

export const retainFilmstrip = (assetId: string): (() => void) => {
  const generation = previewGeneration;
  retainedFilmstrips.set(assetId, (retainedFilmstrips.get(assetId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (generation !== previewGeneration) return;
    const count = (retainedFilmstrips.get(assetId) ?? 1) - 1;
    if (count <= 0) retainedFilmstrips.delete(assetId);
    else retainedFilmstrips.set(assetId, count);
    pruneFilmstrips();
  };
};

export const retainWaveform = (assetId: string): (() => void) => {
  const generation = previewGeneration;
  retainedWaveforms.set(assetId, (retainedWaveforms.get(assetId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (generation !== previewGeneration) return;
    const count = (retainedWaveforms.get(assetId) ?? 1) - 1;
    if (count <= 0) retainedWaveforms.delete(assetId);
    else retainedWaveforms.set(assetId, count);
    pruneWaveforms();
  };
};

export const usePreviewStore = create<PreviewState>((set) => ({
  thumbs: {},
  filmstrips: {},
  waveforms: {},
  remember: (assetId, previews, replaceMissing = true) =>
    set((s) => {
      const thumbs = { ...s.thumbs };
      const filmstrips = { ...s.filmstrips };
      const waveforms = { ...s.waveforms };
      if (previews.thumb) thumbs[assetId] = previews.thumb;
      else if (replaceMissing) delete thumbs[assetId];
      if (previews.filmstrip) {
        filmstrips[assetId] = previews.filmstrip;
        touchFilmstrip(assetId, filmstrips);
      } else if (replaceMissing) {
        delete filmstrips[assetId];
        const prior = filmstripOrder.indexOf(assetId);
        if (prior >= 0) filmstripOrder.splice(prior, 1);
      }
      if (previews.waveform) {
        waveforms[assetId] = previews.waveform;
        touchWaveform(assetId, waveforms);
      } else if (replaceMissing) {
        delete waveforms[assetId];
        const prior = waveformOrder.indexOf(assetId);
        if (prior >= 0) waveformOrder.splice(prior, 1);
      }
      return { thumbs, filmstrips, waveforms };
    }),
  clear: () => {
    previewGeneration++;
    askedThumbs.clear();
    askedFilmstrips.clear();
    askedWaveforms.clear();
    filmstripOrder.length = 0;
    retainedFilmstrips.clear();
    retainedWaveforms.clear();
    waveformOrder.length = 0;
    set({ thumbs: {}, filmstrips: {}, waveforms: {} });
  },
  forget: (assetIds) =>
    set((s) => {
      const thumbs = { ...s.thumbs };
      const filmstrips = { ...s.filmstrips };
      const waveforms = { ...s.waveforms };
      for (const id of assetIds) {
        delete thumbs[id];
        delete filmstrips[id];
        const prior = filmstripOrder.indexOf(id);
        if (prior >= 0) filmstripOrder.splice(prior, 1);
        askedThumbs.delete(id);
        askedFilmstrips.delete(id);
        delete waveforms[id];
        const waveformPrior = waveformOrder.indexOf(id);
        if (waveformPrior >= 0) waveformOrder.splice(waveformPrior, 1);
        askedWaveforms.delete(id);
      }
      return { thumbs, filmstrips, waveforms };
    }),
}));

onPreviewsStored((assetId, previews, { replaceMissing }) => {
  if (previews.thumb || replaceMissing) askedThumbs.add(assetId);
  if (previews.filmstrip || replaceMissing) askedFilmstrips.add(assetId);
  if (previews.waveform || replaceMissing) askedWaveforms.add(assetId);
  usePreviewStore.getState().remember(assetId, previews, replaceMissing);
});

// One batch per kind. An id is asked once per session: an asset without
// a stored thumbnail is not queried again on every render.
const makeBatch = <T>(
  asked: Set<string>,
  load: (ids: readonly string[]) => Promise<ReadonlyMap<string, T>>,
  apply: (found: ReadonlyMap<string, T>, generation: number) => void | Promise<void>,
) => {
  let pending: { id: string; generation: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    timer = null;
    const queued = pending;
    pending = [];
    const generation = previewGeneration;
    const ids = queued.filter((item) => item.generation === generation).map((item) => item.id);
    if (ids.length === 0) return;
    const end = reloadSpan("preview-request");
    try {
      const found = await load(ids);
      if (generation === previewGeneration && found.size > 0) await apply(found, generation);
    } catch {
      for (const id of ids) asked.delete(id);
    } finally { end(); }
  };
  return (assetIds: readonly string[]): void => {
    for (const id of assetIds) {
      if (asked.has(id)) continue;
      asked.add(id);
      pending.push({ id, generation: previewGeneration });
    }
    if (pending.length > 0 && timer === null) timer = setTimeout(() => void flush(), 0);
  };
};

const nextFrame = (): Promise<void> =>
  new Promise((resolve) =>
    typeof requestAnimationFrame === "undefined"
      ? setTimeout(resolve, 0)
      : requestAnimationFrame(() => resolve()),
  );

export const requestThumbs = makeBatch(askedThumbs, getThumbs, async (found, generation) => {
  const entries = [...found];
  for (let offset = 0; offset < entries.length; offset += 100) {
    if (generation !== previewGeneration) return;
    const chunk = Object.fromEntries(entries.slice(offset, offset + 100));
    usePreviewStore.setState((s) => ({ thumbs: { ...s.thumbs, ...chunk } }));
    if (offset + 100 < entries.length) await nextFrame();
  }
});

export const requestFilmstrips = makeBatch(askedFilmstrips, getFilmstrips, (found, generation) => {
  if (generation !== previewGeneration) return;
  usePreviewStore.setState((s) => {
    const filmstrips = { ...s.filmstrips };
    for (const [id, strip] of found) {
      filmstrips[id] = strip;
      touchFilmstrip(id, filmstrips);
    }
    return { filmstrips };
  });
});

export const requestWaveforms = makeBatch(askedWaveforms, getWaveforms, (found, generation) => {
  if (generation !== previewGeneration) return;
  usePreviewStore.setState((s) => {
    const waveforms = { ...s.waveforms };
    for (const [id, waveform] of found) {
      waveforms[id] = waveform;
      touchWaveform(id, waveforms);
    }
    return { waveforms };
  });
});

// Test hook: forget what was asked so a fresh test starts cold.
export const resetPreviewRequestsForTests = (): void => {
  usePreviewStore.getState().clear();
};

type ThumbSource = Pick<MediaAsset, "id" | "thumbDataUrl"> | null | undefined;
type StripSource =
  | Pick<MediaAsset, "id" | "filmstripDataUrl" | "filmstripFrames">
  | null
  | undefined;
type WaveformSource = Pick<MediaAsset, "id" | "waveformPeaks"> | null | undefined;

// The asset's thumbnail: an inline (legacy) one wins, otherwise the store's.
export const useAssetThumb = (asset: ThumbSource, shouldLoad = true): string | undefined => {
  const id = asset?.id;
  const inline = asset?.thumbDataUrl;
  const stored = usePreviewStore((s) => (id ? s.thumbs[id] : undefined));
  useEffect(() => {
    if (shouldLoad && id && !inline && stored === undefined) requestThumbs([id]);
  }, [id, inline, shouldLoad, stored]);
  return inline ?? stored;
};

export const useAssetFilmstrip = (asset: StripSource, shouldLoad = true): Filmstrip | undefined => {
  const id = asset?.id;
  const inline = asset?.filmstripDataUrl;
  const frames = asset?.filmstripFrames ?? 0;
  const stored = usePreviewStore((s) => (id ? s.filmstrips[id] : undefined));
  useEffect(() => {
    if (shouldLoad && id && !inline) return retainFilmstrip(id);
  }, [id, inline, shouldLoad]);
  useEffect(() => {
    if (shouldLoad && id && !inline && stored === undefined) requestFilmstrips([id]);
  }, [id, inline, shouldLoad, stored]);
  return useMemo(() => (inline ? { dataUrl: inline, frames } : stored), [frames, inline, stored]);
};

export const useAssetWaveform = (
  asset: WaveformSource,
  shouldLoad = true,
): readonly number[] | undefined => {
  const id = asset?.id;
  const inline = asset?.waveformPeaks;
  const stored = usePreviewStore((s) => (id ? s.waveforms[id] : undefined));
  useEffect(() => {
    if (shouldLoad && id && !inline) return retainWaveform(id);
  }, [id, inline, shouldLoad]);
  useEffect(() => {
    if (shouldLoad && id && !inline && stored === undefined) requestWaveforms([id]);
  }, [id, inline, shouldLoad, stored]);
  return inline ?? stored;
};

const PREVIEW_ROOT_MARGIN = "240px";
interface SharedObserver {
  observer: IntersectionObserver;
  setters: Map<Element, (visible: boolean) => void>;
}
const visibilityObservers = new Map<string, SharedObserver>();

export const observePreviewVisibility = (
  node: Element,
  setter: (visible: boolean) => void,
  rootMargin = PREVIEW_ROOT_MARGIN,
): (() => void) => {
  if (typeof IntersectionObserver === "undefined") {
    setter(true);
    return () => {};
  }
  let shared = visibilityObservers.get(rootMargin);
  if (!shared) {
    const setters = new Map<Element, (visible: boolean) => void>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setters.get(entry.target)?.(entry.isIntersecting);
      },
      { rootMargin },
    );
    shared = { observer, setters };
    visibilityObservers.set(rootMargin, shared);
  }
  shared.setters.set(node, setter);
  shared.observer.observe(node);
  return () => {
    const current = visibilityObservers.get(rootMargin);
    if (!current) return;
    current.observer.unobserve(node);
    current.setters.delete(node);
    if (current.setters.size === 0) {
      current.observer.disconnect();
      visibilityObservers.delete(rootMargin);
    }
  };
};

export const usePreviewVisibility = (
  ref: RefObject<Element | null>,
  rootMargin = PREVIEW_ROOT_MARGIN,
): boolean => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    return observePreviewVisibility(node, setVisible, rootMargin);
  }, [ref, rootMargin]);
  return visible;
};

// Thumbnails for a list (panels that map over assets cannot call a hook
// per item).
export const useAssetThumbs = (
  assets: readonly Pick<MediaAsset, "id" | "thumbDataUrl">[],
): Readonly<Record<string, string>> => {
  const thumbs = usePreviewStore((s) => s.thumbs);
  useEffect(() => {
    requestThumbs(assets.filter((a) => !a.thumbDataUrl).map((a) => a.id));
  }, [assets]);
  return useMemo(() => {
    const merged: Record<string, string> = {};
    for (const asset of assets) {
      const thumb = asset.thumbDataUrl ?? thumbs[asset.id];
      if (thumb) merged[asset.id] = thumb;
    }
    return merged;
  }, [assets, thumbs]);
};
