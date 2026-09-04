import type { ID, Track } from "@movie-desk/core";

// Asset ids referenced by at least one timeline clip. Derived, never stored:
// the timeline is the source of truth for "used".
export const usedAssetIds = (tracks: readonly Track[]): ReadonlySet<ID> => {
  const used = new Set<ID>();
  for (const track of tracks) {
    for (const clip of track.clips) if (clip.kind === "media") used.add(clip.assetId);
  }
  return used;
};
