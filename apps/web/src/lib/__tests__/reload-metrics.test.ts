import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("reads a throwing storage getter once and shares its no-op", async () => {
  const getter = vi.fn(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  vi.stubGlobal("window", Object.defineProperty({}, "sessionStorage", { get: getter }));
  const { reloadSpan, measureReload } = await import("../reload-metrics");
  expect(reloadSpan("one")).toBe(reloadSpan("two"));
  expect(measureReload("three", () => 42)).toBe(42);
  expect(getter).toHaveBeenCalledTimes(1);
});
