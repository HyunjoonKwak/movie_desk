import type { MediaAsset } from "@movie-desk/core";

interface InlineFilmstrip {
  readonly dataUrl: string;
  readonly frames: number;
}

interface InlineAssetPreviews {
  readonly thumb?: string;
  readonly filmstrip?: InlineFilmstrip;
}

export const hasInlinePreviews = (asset: MediaAsset): boolean =>
  asset.thumbDataUrl !== undefined || asset.filmstripDataUrl !== undefined;

export const inlinePreviewsOf = (asset: MediaAsset): InlineAssetPreviews => ({
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
