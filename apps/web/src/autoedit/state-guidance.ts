// Candidate enumeration is intentionally lazy: progress ticks must not rebuild all candidates.
export const ANALYSIS_HINT_KEYS = {
  running: "state.auto.runningProgress",
  before: "state.auto.before",
  analysisFailed: "auto.reportUnavailableHint",
  noCandidates: "state.auto.noCandidates",
} as const;

export function analysisGuidance(
  {
    total,
    running,
    doneCount,
    failedCount,
  }: { total: number; running: boolean; doneCount: number; failedCount: number },
  candidates: () => number | null,
): keyof typeof ANALYSIS_HINT_KEYS | null {
  if (running) return "running";
  if (doneCount + failedCount < total) return "before";
  if (doneCount === 0 && failedCount > 0) return "analysisFailed";
  const count = candidates();
  return count === 0 ? "noCandidates" : null;
}
