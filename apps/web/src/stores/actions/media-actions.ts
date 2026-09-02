import type { ID, MediaAsset, Ms } from "@movie-desk/core";
import { runWith, type ProjectMutating, type SetFn } from "../store-helpers";

export interface MediaLibraryActions {
  addMediaAsset: (asset: MediaAsset) => void;
  setAssetProxy: (
    assetId: ID,
    proxy: { proxyPath: string; proxyWidth: number; proxyHeight: number },
  ) => void;
  removeMediaAsset: (assetId: ID) => void;
  // 사용 구간 지정 — undefined 전달 시 구간 해제(전체 사용).
  setAssetUseRange: (assetId: ID, range: { inMs: Ms; outMs: Ms } | undefined) => void;
}

export const createMediaActions = <S extends ProjectMutating>(set: SetFn<S>): MediaLibraryActions => ({
  addMediaAsset: (asset) =>
    runWith(set, "Import media", (p) => ({
      ...p,
      mediaLibrary: [...p.mediaLibrary, asset],
    })),

  setAssetProxy: (assetId, proxy) =>
    runWith(set, "Attach proxy", (p) => ({
      ...p,
      mediaLibrary: p.mediaLibrary.map((a) =>
        a.id === assetId
          ? {
              ...a,
              proxyPath: proxy.proxyPath,
              proxyWidth: proxy.proxyWidth,
              proxyHeight: proxy.proxyHeight,
            }
          : a,
      ),
    })),

  setAssetUseRange: (assetId, range) =>
    runWith(set, "Set media range", (p) => ({
      ...p,
      mediaLibrary: p.mediaLibrary.map((a) => {
        if (a.id !== assetId) return a;
        if (!range) {
          const { useInMs: _in, useOutMs: _out, ...rest } = a;
          return rest as MediaAsset;
        }
        const inMs = Math.max(0, Math.min(range.inMs, range.outMs));
        const outMs = Math.min(a.durationMs || range.outMs, Math.max(range.inMs, range.outMs));
        if (outMs - inMs < 200) return a; // 최소 0.2초 미만 구간은 무시
        return { ...a, useInMs: inMs, useOutMs: outMs };
      }),
    })),

  removeMediaAsset: (assetId) =>
    runWith(set, "Remove media", (p) => {
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
