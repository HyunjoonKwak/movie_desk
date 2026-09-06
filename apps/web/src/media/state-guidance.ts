// Keep empty-library and filtered-library guidance distinct so reset never replaces import.
export function mediaGuidance(total: number, shown: number) {
  return total === 0 ? "empty" : shown === 0 ? "filtered" : null;
}
