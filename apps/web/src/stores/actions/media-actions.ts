import { withoutInlinePreviews } from "@/media/inline-previews";
import type { ID, MediaAsset, Ms, SourceRotation } from "@movie-desk/core";

export interface RelinkAssetPatch {
  readonly sizeBytes: number;
  readonly mime: string;
  readonly dropProxy: boolean;
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: SourceRotation;
  // null clears the field (the new file has none); undefined leaves it.
  readonly videoCodec?: string | null;
  readonly audioCodec?: string | null;
  readonly thumbDataUrl?: string | null;
  readonly filmstripDataUrl?: string | null;
  readonly filmstripFrames?: number | null;
  readonly waveformPeaks?: readonly number[] | null;
  readonly previewsStored: boolean;
}

// Applies an optional-or-null patch field immutably.
const withNullable = <K extends keyof MediaAsset>(
  asset: MediaAsset,
  key: K,
  value: MediaAsset[K] | null | undefined,
): MediaAsset => {
  if (value === undefined) return asset;
  if (value === null) {
    const { [key]: _dropped, ...rest } = asset;
    return rest as MediaAsset;
  }
  return { ...asset, [key]: value };
};
import { type ProjectMutating, type SetFn, runWith } from "../store-helpers";

export interface MediaLibraryActions {
  addMediaAsset: (asset: MediaAsset) => void;
  setAssetProxy: (
    assetId: ID,
    proxy: { proxyPath: string; proxyWidth: number; proxyHeight: number },
  ) => void;
  removeMediaAsset: (assetId: ID) => void;
  // A relinked original: a fresh record so decoders and health checks retry.
  relinkMediaAsset: (assetId: ID, patch: RelinkAssetPatch) => void;
  // 사용 구간 지정 — undefined 전달 시 구간 해제(전체 사용).
  setAssetUseRange: (assetId: ID, range: { inMs: Ms; outMs: Ms } | undefined) => void;
  // Maintenance: inline previews were moved to the preview store. Not an
  // undo step — the pictures are the same, only where they live changed.
  dropInlinePreviews: (assetIds: readonly ID[]) => void;
}

export const createMediaActions = <S extends ProjectMutating>(
  set: SetFn<S>,
): MediaLibraryActions => ({
  addMediaAsset: (asset) =>
    runWith(set, "Import media", (p) => ({
      ...p,
      mediaLibrary: [...p.mediaLibrary, asset],
    })),

  setAssetProxy: (assetId, proxy) =>
    runWith(set, "Attach proxy", (p) => {
      const asset = p.mediaLibrary.find((a) => a.id === assetId);
      if (
        !asset ||
        (asset.proxyPath === proxy.proxyPath &&
          asset.proxyWidth === proxy.proxyWidth &&
          asset.proxyHeight === proxy.proxyHeight)
      )
        return p;
      return {
        ...p,
        mediaLibrary: p.mediaLibrary.map((a) => (a.id === assetId ? { ...a, ...proxy } : a)),
      };
    }),

  dropInlinePreviews: (assetIds) =>
    set((s) => {
      // Opening a legacy project intentionally causes one persistence save:
      // this maintenance write makes all later edits small, but stays outside
      // undo history because the visible preview itself did not change.
      const ids = new Set(assetIds);
      let changed = false;
      const mediaLibrary = s.project.mediaLibrary.map((asset) => {
        if (!ids.has(asset.id)) return asset;
        const next = withoutInlinePreviews(asset);
        if (next !== asset) changed = true;
        return next;
      });
      return changed ? ({ project: { ...s.project, mediaLibrary } } as unknown as Partial<S>) : {};
    }),

  setAssetUseRange: (assetId, range) =>
    runWith(set, "Set media range", (p) => {
      const asset = p.mediaLibrary.find((a) => a.id === assetId);
      if (!asset) return p;
      if (!range) {
        if (asset.useInMs === undefined && asset.useOutMs === undefined) return p;
        const { useInMs: _in, useOutMs: _out, ...rest } = asset;
        return {
          ...p,
          mediaLibrary: p.mediaLibrary.map((a) => (a.id === assetId ? (rest as MediaAsset) : a)),
        };
      }
      const inMs = Math.max(0, Math.min(range.inMs, range.outMs));
      const outMs = Math.min(asset.durationMs || range.outMs, Math.max(range.inMs, range.outMs));
      if (outMs - inMs < 200 || (asset.useInMs === inMs && asset.useOutMs === outMs)) return p;
      return {
        ...p,
        mediaLibrary: p.mediaLibrary.map((a) =>
          a.id === assetId ? { ...a, useInMs: inMs, useOutMs: outMs } : a,
        ),
      };
    }),

  relinkMediaAsset: (assetId, patch) =>
    runWith(set, "Relink media", (p) => {
      if (!p.mediaLibrary.some((asset) => asset.id === assetId)) return p;
      return {
        ...p,
        mediaLibrary: p.mediaLibrary.map((a) => {
          if (a.id !== assetId) return a;
          const { proxyPath: _p, proxyWidth: _w, proxyHeight: _h, ...withoutProxy } = a;
          let next: MediaAsset = {
            ...(patch.dropProxy ? (withoutProxy as MediaAsset) : a),
            sizeBytes: patch.sizeBytes,
            mime: patch.mime,
            ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
            ...(patch.width !== undefined ? { width: patch.width } : {}),
            ...(patch.height !== undefined ? { height: patch.height } : {}),
            ...(patch.rotation !== undefined ? { rotation: patch.rotation } : {}),
          };
          next = withNullable(next, "videoCodec", patch.videoCodec);
          next = withNullable(next, "audioCodec", patch.audioCodec);
          next = withNullable(next, "thumbDataUrl", patch.thumbDataUrl);
          next = withNullable(next, "filmstripDataUrl", patch.filmstripDataUrl);
          next = withNullable(next, "filmstripFrames", patch.filmstripFrames);
          next = withNullable(next, "waveformPeaks", patch.waveformPeaks);
          return next;
        }),
      };
    }),

  removeMediaAsset: (assetId) =>
    runWith(set, "Remove media", (p) => {
      if (!p.mediaLibrary.some((asset) => asset.id === assetId)) return p;
      // Cascade: drop every timeline clip that referenced this asset.
      const tracks = p.timeline.tracks.map((tr) => ({
        ...tr,
        clips: tr.clips.filter((c) => c.kind !== "media" || c.assetId !== assetId),
      }));
      return {
        ...p,
        mediaLibrary: p.mediaLibrary.filter((a) => a.id !== assetId),
        timeline: { ...p.timeline, tracks },
      };
    }),
});
