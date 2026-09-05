import {
  type AssetPreviews,
  type Filmstrip,
  getFilmstrips,
  getThumbs,
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
  remember: (assetId: string, previews: AssetPreviews, replaceMissing?: boolean) => void;
  forget: (assetIds: readonly string[]) => void;
  clear: () => void;
}

const MAX_FILMSTRIPS = 200;
const filmstripOrder: string[] = [];
const retainedFilmstrips = new Map<string, number>();
const askedThumbs = new Set<string>();
const askedFilmstrips = new Set<string>();
let previewGeneration = 0;
const touchFilmstrip = (assetId: string, filmstrips: Record<string, Filmstrip>): void => {
  const prior = filmstripOrder.indexOf(assetId);
  if (prior >= 0) filmstripOrder.splice(prior, 1);
  filmstripOrder.push(assetId);
  let candidates = filmstripOrder.length;
  while (filmstripOrder.length > MAX_FILMSTRIPS && candidates > 0) {
    candidates--;
    const evicted = filmstripOrder.shift();
    if (!evicted) break;
    if (retainedFilmstrips.has(evicted)) {
      filmstripOrder.push(evicted);
      continue;
    }
    delete filmstrips[evicted];
    askedFilmstrips.delete(evicted);
  }
};

const pruneFilmstrips = (): void => {
  usePreviewStore.setState((state) => {
    const filmstrips = { ...state.filmstrips };
    let candidates = filmstripOrder.length;
    while (filmstripOrder.length > MAX_FILMSTRIPS && candidates > 0) {
      candidates--;
      const evicted = filmstripOrder.shift();
      if (!evicted) break;
      if (retainedFilmstrips.has(evicted)) {
        filmstripOrder.push(evicted);
        continue;
      }
      delete filmstrips[evicted];
      askedFilmstrips.delete(evicted);
    }
    return { filmstrips };
  });
};

export const retainFilmstrip = (assetId: string): (() => void) => {
  retainedFilmstrips.set(assetId, (retainedFilmstrips.get(assetId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (retainedFilmstrips.get(assetId) ?? 1) - 1;
    if (count <= 0) retainedFilmstrips.delete(assetId);
    else retainedFilmstrips.set(assetId, count);
    pruneFilmstrips();
  };
};

export const usePreviewStore = create<PreviewState>((set) => ({
  thumbs: {},
  filmstrips: {},
  remember: (assetId, previews, replaceMissing = true) =>
    set((s) => {
      const thumbs = { ...s.thumbs };
      const filmstrips = { ...s.filmstrips };
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
      return { thumbs, filmstrips };
    }),
  clear: () => {
    previewGeneration++;
    askedThumbs.clear();
    askedFilmstrips.clear();
    filmstripOrder.length = 0;
    set({ thumbs: {}, filmstrips: {} });
  },
  forget: (assetIds) =>
    set((s) => {
      const thumbs = { ...s.thumbs };
      const filmstrips = { ...s.filmstrips };
      for (const id of assetIds) {
        delete thumbs[id];
        delete filmstrips[id];
        const prior = filmstripOrder.indexOf(id);
        if (prior >= 0) filmstripOrder.splice(prior, 1);
        askedThumbs.delete(id);
        askedFilmstrips.delete(id);
      }
      return { thumbs, filmstrips };
    }),
}));

onPreviewsStored((assetId, previews, { replaceMissing }) => {
  if (previews.thumb || replaceMissing) askedThumbs.add(assetId);
  if (previews.filmstrip || replaceMissing) askedFilmstrips.add(assetId);
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
    try {
      const found = await load(ids);
      if (generation === previewGeneration && found.size > 0) await apply(found, generation);
    } catch {
      for (const id of ids) asked.delete(id);
    }
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

// Test hook: forget what was asked so a fresh test starts cold.
export const resetPreviewRequestsForTests = (): void => {
  usePreviewStore.getState().clear();
};

type ThumbSource = Pick<MediaAsset, "id" | "thumbDataUrl"> | null | undefined;
type StripSource =
  | Pick<MediaAsset, "id" | "filmstripDataUrl" | "filmstripFrames">
  | null
  | undefined;

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

export const useAssetFilmstrip = (asset: StripSource): Filmstrip | undefined => {
  const id = asset?.id;
  const inline = asset?.filmstripDataUrl;
  const frames = asset?.filmstripFrames ?? 0;
  const stored = usePreviewStore((s) => (id ? s.filmstrips[id] : undefined));
  useEffect(() => {
    if (id && !inline) return retainFilmstrip(id);
  }, [id, inline]);
  useEffect(() => {
    if (id && !inline && stored === undefined) requestFilmstrips([id]);
  }, [id, inline, stored]);
  return useMemo(() => (inline ? { dataUrl: inline, frames } : stored), [frames, inline, stored]);
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
