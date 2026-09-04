import type { ID, MediaAsset, Rating } from "@movie-desk/core";
import { withTag, withoutTag } from "@/media/tags";
import { type ProjectMutating, type SetFn, runWith } from "../store-helpers";

// Library marks on assets: rating, favourite, tags. Every action takes a set
// of asset ids so a selection is one undo step, and records are replaced
// only when something changes (a health/search cache keys on identity).
export interface LibraryMarkActions {
  setAssetsRating: (assetIds: readonly ID[], rating: Rating | null) => void;
  setAssetsFavorite: (assetIds: readonly ID[], favorite: boolean) => void;
  addAssetsTags: (assetIds: readonly ID[], tags: readonly string[]) => void; // one undo step
  removeAssetsTag: (assetIds: readonly ID[], tag: string) => void;
}

const mapSelected = (
  set: SetFn<ProjectMutating>,
  label: string,
  assetIds: readonly ID[],
  update: (asset: MediaAsset) => MediaAsset,
): void => {
  const ids = new Set(assetIds);
  runWith(set, label, (p) => {
    let changed = false;
    const mediaLibrary = p.mediaLibrary.map((asset) => {
      if (!ids.has(asset.id)) return asset;
      const next = update(asset);
      if (next !== asset) changed = true;
      return next;
    });
    return changed ? { ...p, mediaLibrary } : p;
  });
};

const withoutField = <K extends keyof MediaAsset>(asset: MediaAsset, key: K): MediaAsset => {
  if (!(key in asset)) return asset;
  const { [key]: _dropped, ...rest } = asset;
  return rest as MediaAsset;
};

export const createLibraryMarkActions = <S extends ProjectMutating>(
  set: SetFn<S>,
): LibraryMarkActions => {
  const setter = set as unknown as SetFn<ProjectMutating>;
  return {
    setAssetsRating: (assetIds, rating) =>
      mapSelected(setter, rating === null ? "Clear rating" : "Rate media", assetIds, (asset) => {
        if (rating === null) return withoutField(asset, "rating");
        return asset.rating === rating ? asset : { ...asset, rating };
      }),

    setAssetsFavorite: (assetIds, favorite) =>
      mapSelected(setter, favorite ? "Favourite media" : "Unfavourite media", assetIds, (asset) => {
        if (!favorite) return withoutField(asset, "favorite");
        return asset.favorite ? asset : { ...asset, favorite: true };
      }),

    addAssetsTags: (assetIds, newTags) =>
      mapSelected(setter, "Tag media", assetIds, (asset) => {
        const current = asset.tags ?? [];
        const tags = newTags.reduce<readonly string[]>((acc, tag) => withTag(acc, tag), current);
        return tags === current ? asset : { ...asset, tags };
      }),

    removeAssetsTag: (assetIds, tag) =>
      mapSelected(setter, "Untag media", assetIds, (asset) => {
        if (!asset.tags) return asset;
        const tags = withoutTag(asset.tags, tag);
        if (tags.length === asset.tags.length) return asset;
        return tags.length === 0 ? withoutField(asset, "tags") : { ...asset, tags };
      }),
  };
};
