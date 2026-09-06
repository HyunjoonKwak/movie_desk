import type { FunnelEvent } from "@/persistence/funnel-log";
export type FunnelEmit = (projectId: string, event: FunnelEvent) => void;
export type RecoveryKind = Extract<FunnelEvent, { event: "recovery" }>["data"]["kind"];
export type RecoveryHint = "media-missing-hint" | null;
export const recoveryHintVisible = (hint: RecoveryHint): boolean => {
  if (!hint || typeof document === "undefined") return false;
  try {
    return !!document.querySelector(`[data-state-hint][data-testid="${hint}"]`)?.getClientRects()
      .length;
  } catch {
    return false;
  }
};
export const createRecoveryEpisode = (
  projectId: string,
  kind: RecoveryKind,
  assets: number,
  episode: number,
  hint: RecoveryHint,
  emit: FunnelEmit,
  visible = recoveryHintVisible,
) => {
  let resolved = 0;
  let finished = false;
  const write = (result: "pending" | "success" | "abandoned") =>
    emit(projectId, {
      event: "recovery",
      data: { kind, result, assets, resolved, episode, hintVisible: visible(hint) },
    });
  write("pending");
  return {
    get finished() {
      return finished;
    },
    resolve(count = 1) {
      if (finished) return;
      resolved = Math.min(assets, resolved + count);
      if (resolved >= assets) {
        finished = true;
        write("success");
      }
    },
    abandon() {
      if (finished) return;
      finished = true;
      write("abandoned");
    },
  };
};
export type RecoveryEpisode = ReturnType<typeof createRecoveryEpisode>;
/** Close an unfinished recovery before opening the next one in the same UI slot. */
export const replaceRecoveryEpisode = (
  slot: { current: RecoveryEpisode | null },
  start: () => RecoveryEpisode,
): RecoveryEpisode => {
  slot.current?.abandon();
  const episode = start();
  slot.current = episode;
  return episode;
};
export const createExportEpisode = (
  projectId: string,
  assets: number,
  clips: number,
  emit: FunnelEmit,
) => {
  let cancelled = false;
  let finished = false;
  emit(projectId, { event: "export-start", data: {} });
  return {
    record(outcome: "success" | "failure" | "cancelled") {
      if (finished) return;
      if (outcome === "success") {
        finished = true;
        emit(projectId, { event: "export-success", data: { assets, clips } });
      } else cancelled = outcome === "cancelled";
    },
    finish() {
      if (finished) return;
      finished = true;
      emit(projectId, { event: "export-failure", data: { cancelled } });
    },
  };
};
