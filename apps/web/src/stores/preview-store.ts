import {
  type AssetPreviews,
  type Filmstrip,
  getFilmstrips,
  getThumbs,
  onPreviewsStored,
} from "@/persistence/previews";
import type { MediaAsset } from "@movie-desk/core";
import { useEffect } from "react";
import { create } from "zustand";

// In-memory previews for the session. Thumbnails are small and kept for
// every asset asked for; filmstrips are loaded only for the assets the
// timeline or the range editor shows. Requests are batched into one
// database read per tick, so a thousand cards mounting cost one query.
interface PreviewState {
  readonly thumbs: Readonly<Record<string, string>>;
  readonly filmstrips: Readonly<Record<string, Filmstrip>>;
  remember: (assetId: string, previews: AssetPreviews) => void;
  forget: (assetIds: readonly string[]) => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  thumbs: {},
  filmstrips: {},
  remember: (assetId, previews) =>
    set((s) => {
      const thumbs = { ...s.thumbs };
      const filmstrips = { ...s.filmstrips };
      if (previews.thumb) thumbs[assetId] = previews.thumb;
      else delete thumbs[assetId];
      if (previews.filmstrip) filmstrips[assetId] = previews.filmstrip;
      else delete filmstrips[assetId];
      return { thumbs, filmstrips };
    }),
  forget: (assetIds) =>
    set((s) => {
      const thumbs = { ...s.thumbs };
      const filmstrips = { ...s.filmstrips };
      for (const id of assetIds) {
        delete thumbs[id];
        delete filmstrips[id];
        askedThumbs.delete(id);
        askedFilmstrips.delete(id);
      }
      return { thumbs, filmstrips };
    }),
}));

onPreviewsStored((assetId, previews) => {
  askedThumbs.add(assetId);
  askedFilmstrips.add(assetId);
  usePreviewStore.getState().remember(assetId, previews);
});

// One batch per kind. An id is asked once per session: an asset without
// a stored thumbnail is not queried again on every render.
const makeBatch = <T>(
  asked: Set<string>,
  load: (ids: readonly string[]) => Promise<ReadonlyMap<string, T>>,
  apply: (found: ReadonlyMap<string, T>) => void,
) => {
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    timer = null;
    const ids = pending;
    pending = [];
    try {
      const found = await load(ids);
      if (found.size > 0) apply(found);
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

export const requestThumbs = makeBatch(askedThumbs, getThumbs, (found) =>
  usePreviewStore.setState((s) => ({ thumbs: { ...s.thumbs, ...Object.fromEntries(found) } })),
);

const requestFilmstrips = makeBatch(askedFilmstrips, getFilmstrips, (found) =>
  usePreviewStore.setState((s) => ({
    filmstrips: { ...s.filmstrips, ...Object.fromEntries(found) },
  })),
);

// Test hook: forget what was asked so a fresh test starts cold.
export const resetPreviewRequestsForTests = (): void => {
  askedThumbs.clear();
  askedFilmstrips.clear();
  usePreviewStore.setState({ thumbs: {}, filmstrips: {} });
};

type ThumbSource = Pick<MediaAsset, "id" | "thumbDataUrl"> | null | undefined;
type StripSource =
  | Pick<MediaAsset, "id" | "filmstripDataUrl" | "filmstripFrames">
  | null
  | undefined;

// The asset's thumbnail: an inline (legacy) one wins, otherwise the store's.
export const useAssetThumb = (asset: ThumbSource): string | undefined => {
  const id = asset?.id;
  const inline = asset?.thumbDataUrl;
  const stored = usePreviewStore((s) => (id ? s.thumbs[id] : undefined));
  useEffect(() => {
    if (id && !inline && stored === undefined) requestThumbs([id]);
  }, [id, inline, stored]);
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
  return inline ? { dataUrl: inline, frames } : stored;
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
