// Keep empty-library and filtered-library guidance distinct so reset never replaces import.
export const MEDIA_HINT_KEYS = {
  empty: "state.media.empty",
  filtered: "state.media.filtered",
} as const;

export function mediaGuidance(total: number, shown: number) {
  return total === 0 ? "empty" : shown === 0 ? "filtered" : null;
}
