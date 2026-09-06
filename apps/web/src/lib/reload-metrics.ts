// Opt-in startup measurements; storage denial must never affect restoration.
const noop = () => {};
let enabled: boolean | undefined;
const metricsEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  if (enabled === undefined) {
    try {
      enabled = Boolean(window.sessionStorage.getItem("bench.reload"));
    } catch {
      enabled = false;
    }
  }
  return enabled;
};
export const markReloadGridReady = (): void => {
  if (metricsEnabled() && performance.getEntriesByName("reload:grid-ready").length === 0) {
    performance.mark("reload:grid-ready");
  }
};
export const reloadSpan = (name: string): (() => void) => {
  if (!metricsEnabled()) return noop;
  const start = performance.now();
  return () => {
    performance.measure(`reload:${name}`, { start, end: performance.now() });
  };
};
export const measureReload = <T>(name: string, run: () => T): T => {
  const end = reloadSpan(name);
  try {
    return run();
  } finally {
    end();
  }
};
