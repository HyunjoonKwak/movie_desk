import {
  createRecoveryEpisode,
  createExportEpisode,
  recoveryHintVisible,
  type RecoveryKind,
  type RecoveryHint,
} from "./episodes";
import {
  appendFunnelRow,
  discardFunnelQueue,
  flushFunnelLog,
  type FunnelEvent,
} from "@/persistence/funnel-log";
import { useProjectStore } from "@/stores/project-store";
import type { Project } from "@movie-desk/core";

export const FUNNEL_OPT_IN_KEY = "movie-desk.funnel.enabled.v1";
let enabled = false;
let epoch = 0;
let stop: (() => void) | undefined;
let pending = Promise.resolve();
let sequence = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const activity = new Map<string, { commands: number; undos: number }>();
const flushActivity = () => {
  for (const [id, data] of activity) recordFunnel(id, { event: "activity", data });
  activity.clear();
};
export const flushFunnelCollection = async () => {
  flushActivity();
  await pending;
  await flushFunnelLog();
};
export const measurementProjectId = async (id: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
export const settleFunnelCollection = flushFunnelCollection;
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
        if (epoch === token)
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
  countActivity = (id: string, key: "commands" | "undos") => {
    const prior = activity.get(id) ?? { commands: 0, undos: 0 };
    activity.set(id, { ...prior, [key]: prior[key] + 1 });
  },
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
      prior = { ...prior, imported: true };
      seen.set(p.id, prior);
      emit(p.id, { event: "import", data: { baseline } });
    }
    if (
      !prior.placed &&
      (!previous || previous.project.timeline.tracks !== p.timeline.tracks) &&
      clips(p) > 0
    ) {
      prior = { ...prior, placed: true };
      seen.set(p.id, prior);
      emit(p.id, { event: "clip", data: { baseline } });
    }
    if (!previous || previous.project.id !== p.id || previous.history === state.history) return;
    if (state.history.future.length > previous.history.future.length) countActivity(p.id, "undos");
    else if (
      state.history.past.at(-1) !== previous.history.past.at(-1) &&
      state.history.past.length > 0 &&
      state.history.past.at(-1) !== previous.history.future[0]
    ) {
      countActivity(p.id, "commands");
    }
  };
  observe(initial);
  return subscribe((state, previous) => observe(state, previous));
};
export const setFunnelEnabled = (value: boolean): void => {
  stop?.();
  stop = undefined;
  enabled = value;
  clearInterval(timer);
  if (!value) {
    epoch++;
    activity.clear();
    discardFunnelQueue();
  }
  try {
    localStorage.setItem(FUNNEL_OPT_IN_KEY, value ? "1" : "0");
  } catch {
    /* Session opt-in still works. */
  }
  if (value) {
    timer = setInterval(() => void flushFunnelCollection(), 5 * 60_000);
    stop = observeFunnel(
      useProjectStore.getState(),
      (listener) => useProjectStore.subscribe(listener),
      recordFunnel,
    );
  }
};
export const mountFunnel = (): (() => void) => {
  try {
    if (localStorage.getItem(FUNNEL_OPT_IN_KEY) === "1") setFunnelEnabled(true);
  } catch {
    /* Default off. */
  }
  const hide = () => {
    void flushFunnelCollection();
  };
  const visibility = () => {
    if (document.visibilityState === "hidden") hide();
  };
  window.addEventListener("pagehide", hide);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    stop?.();
    stop = undefined;
    clearInterval(timer);
    // Start draining accepted rows before disabling new capture; retain epoch.
    void flushFunnelCollection();
    enabled = false;
    window.removeEventListener("pagehide", hide);
    document.removeEventListener("visibilitychange", visibility);
  };
};
const episodeEmit = () => {
  const token = epoch;
  const active = enabled;
  return (id: string, event: FunnelEvent) => {
    if (active && enabled && token === epoch) recordFunnel(id, event);
  };
};
export const recordExport = (projectId: string) => {
  const project = useProjectStore.getState().project;
  return createExportEpisode(projectId, project.mediaLibrary.length, clips(project), episodeEmit());
};
export const recordRecovery = (
  kind: RecoveryKind,
  assets: number,
  hint: RecoveryHint,
  projectId = useProjectStore.getState().project.id,
) =>
  createRecoveryEpisode(
    projectId,
    kind,
    assets,
    Date.now() * 1000 + (++sequence % 1000),
    hint,
    episodeEmit(),
    enabled ? recoveryHintVisible : () => false,
  );
