// Ignore stale selection IDs and avoid allocating a clip array on timeline updates.
import type { Track } from "@movie-desk/core";

export function timelineGuidance(tracks: readonly Track[], selected: ReadonlySet<string>) {
  let total = 0;
  let count = 0;
  let locked = false;
  for (const track of tracks) {
    locked ||= track.locked;
    for (const clip of track.clips) {
      total++;
      if (selected.has(clip.id)) count++;
    }
  }
  return {
    state: total === 0 ? "empty" : count === 0 ? "unselected" : "selected",
    count,
    locked,
  } as const;
}
