// Opt-in startup measurements; disabled during ordinary use.
export const reloadSpan = (name: string): (() => void) => {
  if (typeof window === "undefined" || !sessionStorage.getItem("bench.reload")) return () => {};
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
