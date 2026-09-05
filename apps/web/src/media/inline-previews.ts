import type { MediaAsset } from "@movie-desk/core";

export interface Filmstrip {
  readonly dataUrl: string;
  readonly frames: number;
}

export interface AssetPreviews {
  readonly thumb?: string;
  readonly filmstrip?: Filmstrip;
}

export const hasInlinePreviews = (asset: MediaAsset): boolean =>
  asset.thumbDataUrl !== undefined || asset.filmstripDataUrl !== undefined;

export const inlinePreviewsOf = (asset: MediaAsset): AssetPreviews => ({
  ...(asset.thumbDataUrl ? { thumb: asset.thumbDataUrl } : {}),
  ...(asset.filmstripDataUrl
    ? { filmstrip: { dataUrl: asset.filmstripDataUrl, frames: asset.filmstripFrames ?? 0 } }
    : {}),
});

export const withoutInlinePreviews = (asset: MediaAsset): MediaAsset => {
  if (!hasInlinePreviews(asset) && asset.filmstripFrames === undefined) return asset;
  const { thumbDataUrl: _t, filmstripDataUrl: _f, filmstripFrames: _n, ...rest } = asset;
  return rest as MediaAsset;
};
