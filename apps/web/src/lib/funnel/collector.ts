import { appendFunnelRow, discardFunnelQueue, type FunnelEvent } from "@/persistence/funnel-log";
import { useProjectStore } from "@/stores/project-store";
import type { Project } from "@movie-desk/core";

export const FUNNEL_OPT_IN_KEY = "movie-desk.funnel.enabled.v1";
let enabled = false;
let epoch = 0;
let stop: (() => void) | undefined;
let pending = Promise.resolve();
let sequence = 0;
export const measurementProjectId = async (id: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
export const settleFunnelCollection = () => pending;
export const funnelEnabled = () => enabled;
export const recordFunnel = (projectId: string, event: FunnelEvent): void => {
  if (!enabled) return;
  const at = Date.now();
  const token = epoch;
  pending = pending
    .catch(() => {})
    .then(async () => {
      try {
        const id = await measurementProjectId(projectId);
        if (enabled && epoch === token)
          appendFunnelRow({
            ...event,
            id: `${(++sequence).toString(16).padStart(8, "0")}-${crypto.randomUUID().slice(9)}`,
            projectId: id,
            at,
          });
      } catch {
        /* Best effort, including unavailable Web Crypto. */
      }
    });
};
const clips = (project: Project) =>
  project.timeline.tracks.reduce((n, track) => n + track.clips.length, 0);
type State = ReturnType<typeof useProjectStore.getState>;
export const observeFunnel = (
  initial: State,
  subscribe: (listener: (state: State, previous: State) => void) => () => void,
  emit: typeof recordFunnel,
): (() => void) => {
  const seen = new Map<string, { imported: boolean; placed: boolean }>();
  const observe = (state: State, previous?: State) => {
    const p = state.project;
    let prior = seen.get(p.id);
    if (!prior) {
      prior = { imported: false, placed: false };
      seen.set(p.id, prior);
      emit(p.id, { event: "start", data: { baseline: true } });
    }
    const baseline = !previous || previous.project.id !== p.id;
    if (!prior.imported && p.mediaLibrary.length > 0) {
      prior.imported = true;
      emit(p.id, { event: "import", data: { baseline } });
    }
    if (
      !prior.placed &&
      (!previous || previous.project.timeline.tracks !== p.timeline.tracks) &&
      clips(p) > 0
    ) {
      prior.placed = true;
      emit(p.id, { event: "clip", data: { baseline } });
    }
    if (!previous || previous.project.id !== p.id || previous.history === state.history) return;
    if (state.history.future.length > previous.history.future.length)
      emit(p.id, { event: "undo", data: {} });
    else if (
      state.history.past.at(-1) !== previous.history.past.at(-1) &&
      state.history.past.length > 0 &&
      state.history.past.at(-1) !== previous.history.future[0]
    ) {
      emit(p.id, { event: "command", data: {} });
    }
  };
  observe(initial);
  return subscribe((state, previous) => observe(state, previous));
};
export const setFunnelEnabled = (value: boolean): void => {
  stop?.();
  stop = undefined;
  enabled = value;
  epoch++;
  discardFunnelQueue();
  try {
    localStorage.setItem(FUNNEL_OPT_IN_KEY, value ? "1" : "0");
  } catch {
    /* Session opt-in still works. */
  }
  if (value)
    stop = observeFunnel(
      useProjectStore.getState(),
      (listener) => useProjectStore.subscribe(listener),
      recordFunnel,
    );
};
export const mountFunnel = (): (() => void) => {
  try {
    if (localStorage.getItem(FUNNEL_OPT_IN_KEY) === "1") setFunnelEnabled(true);
  } catch {
    /* Default off. */
  }
  return () => {
    stop?.();
    stop = undefined;
    enabled = false;
    epoch++;
    discardFunnelQueue();
  };
};
export const recordExport = (
  projectId: string,
  outcome: "start" | "success" | "failure" | "cancelled",
) => {
  if (!enabled) return;
  const project = useProjectStore.getState().project;
  if (outcome === "success") {
    // A project switch during rendering cannot credit another project.
    if (project.id === projectId)
      recordFunnel(projectId, {
        event: "export-success",
        data: { assets: project.mediaLibrary.length, clips: clips(project) },
      });
  } else if (outcome === "start") recordFunnel(projectId, { event: "export-start", data: {} });
  else
    recordFunnel(projectId, {
      event: "export-failure",
      data: { cancelled: outcome === "cancelled" },
    });
};
type Recovery = Extract<FunnelEvent, { event: "recovery" }>["data"];
export const recordRecovery = (
  kind: Recovery["kind"],
  result: Recovery["result"],
  projectId = useProjectStore.getState().project.id,
): void => {
  if (!enabled) return;
  try {
    const hintVisible =
      typeof document !== "undefined" &&
      [...document.querySelectorAll("[data-state-hint]")].some(
        (hint) => hint.getClientRects().length > 0,
      );
    recordFunnel(projectId, { event: "recovery", data: { kind, result, hintVisible } });
  } catch {
    /* DOM instrumentation never blocks recovery. */
  }
};
