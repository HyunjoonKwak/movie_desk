import type { MediaAsset } from "@movie-desk/core";

export interface Filmstrip {
  readonly dataUrl: string;
  readonly frames: number;
}

export interface AssetPreviews {
  readonly thumb?: string;
  readonly filmstrip?: Filmstrip;
  readonly waveform?: readonly number[];
}

export const hasInlinePreviews = (asset: MediaAsset): boolean =>
  asset.thumbDataUrl !== undefined ||
  asset.filmstripDataUrl !== undefined ||
  asset.waveformPeaks !== undefined;

export const inlinePreviewsOf = (asset: MediaAsset): AssetPreviews => ({
  ...(asset.thumbDataUrl ? { thumb: asset.thumbDataUrl } : {}),
  ...(asset.filmstripDataUrl
    ? { filmstrip: { dataUrl: asset.filmstripDataUrl, frames: asset.filmstripFrames ?? 0 } }
    : {}),
  ...(asset.waveformPeaks ? { waveform: asset.waveformPeaks } : {}),
});

export const withoutInlinePreviews = (asset: MediaAsset): MediaAsset => {
  if (!hasInlinePreviews(asset) && asset.filmstripFrames === undefined) return asset;
  const {
    thumbDataUrl: _t,
    filmstripDataUrl: _f,
    filmstripFrames: _n,
    waveformPeaks: _w,
    ...rest
  } = asset;
  return {
    ...rest,
    ...(!("hasAudio" in rest) && (asset.waveformPeaks?.length ?? 0) > 0
      ? { hasAudio: true }
      : {}),
  } as MediaAsset;
};
