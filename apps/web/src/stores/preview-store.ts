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
const touchFilmstrip = (assetId: string, filmstrips: Record<string, Filmstrip>): void => {
  const prior = filmstripOrder.indexOf(assetId);
  if (prior >= 0) filmstripOrder.splice(prior, 1);
  filmstripOrder.push(assetId);
  while (filmstripOrder.length > MAX_FILMSTRIPS) {
    const evicted = filmstripOrder.shift();
    if (evicted) delete filmstrips[evicted];
  }
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
  apply: (found: ReadonlyMap<string, T>) => void | Promise<void>,
) => {
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    timer = null;
    const ids = pending;
    pending = [];
    try {
      const found = await load(ids);
      if (found.size > 0) await apply(found);
    } catch {
      for (const id of ids) asked.delete(id);
    }
  };
  return (assetIds: readonly string[]): void => {
    for (const id of assetIds) {
      if (asked.has(id)) continue;
      asked.add(id);
      pending.push(id);
    }
    if (pending.length > 0 && timer === null) timer = setTimeout(() => void flush(), 0);
  };
};

const askedThumbs = new Set<string>();
const askedFilmstrips = new Set<string>();

const nextFrame = (): Promise<void> =>
  new Promise((resolve) =>
    typeof requestAnimationFrame === "undefined"
      ? setTimeout(resolve, 0)
      : requestAnimationFrame(() => resolve()),
  );

export const requestThumbs = makeBatch(askedThumbs, getThumbs, async (found) => {
  const entries = [...found];
  for (let offset = 0; offset < entries.length; offset += 100) {
    const chunk = Object.fromEntries(entries.slice(offset, offset + 100));
    usePreviewStore.setState((s) => ({ thumbs: { ...s.thumbs, ...chunk } }));
    if (offset + 100 < entries.length) await nextFrame();
  }
});

const requestFilmstrips = makeBatch(askedFilmstrips, getFilmstrips, (found) =>
  usePreviewStore.setState((s) => ({
    filmstrips: { ...s.filmstrips, ...Object.fromEntries(found) },
  })),
);

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
    if (id && !inline && stored === undefined) requestFilmstrips([id]);
  }, [id, inline, stored]);
  return useMemo(() => (inline ? { dataUrl: inline, frames } : stored), [frames, inline, stored]);
};

export const usePreviewVisibility = (
  ref: RefObject<Element | null>,
  rootMargin = "240px",
): boolean => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
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
  const merged: Record<string, string> = {};
  for (const asset of assets) {
    const thumb = asset.thumbDataUrl ?? thumbs[asset.id];
    if (thumb) merged[asset.id] = thumb;
  }
  return merged;
};
