import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ capture: vi.fn(), dispose: vi.fn() }));
vi.mock("../readback", () => ({
  ScopeReadback: class {
    capture = mock.capture;
    dispose = mock.dispose;
  },
}));
let raf: FrameRequestCallback[];
let events: string[];
beforeEach(() => {
  vi.resetModules();
  mock.capture.mockReset();
  mock.dispose.mockReset();
  raf = [];
  events = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    raf.push(callback);
    return raf.length;
  });
  vi.stubGlobal("window", {
    dispatchEvent: (event: Event) => {
      events.push(event.type);
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
const canvas = Object.assign(new EventTarget(), {
  width: 1920,
  height: 1080,
  getContext: () => ({ isContextLost: () => false }),
}) as unknown as HTMLCanvasElement;
it("coalesces busy frames and requests the latest paused frame once", async () => {
  const frames = await import("../frames");
  const listener = vi.fn();
  frames.subscribeFrames(listener);
  frames.captureScopes(canvas);
  frames.captureScopes(canvas);
  expect(mock.capture).toHaveBeenCalledTimes(1);
  mock.capture.mock.calls[0]![0]({ pixels: new Uint8ClampedArray(4) });
  expect(listener).toHaveBeenCalledTimes(1);
  frames.releaseFrame();
  expect(events).toHaveLength(1);
  raf.shift()!(0);
  expect(events).toEqual(["scopes-redraw", "scopes-redraw"]);
  frames.captureScopes(canvas);
  expect(mock.capture).toHaveBeenCalledTimes(2);
});
it("disposes pending GPU work and rejects late deliveries on unsubscribe", async () => {
  const frames = await import("../frames");
  const listener = vi.fn();
  const stop = frames.subscribeFrames(listener);
  frames.captureScopes(canvas);
  stop();
  mock.capture.mock.calls[0]![0]({ pixels: new Uint8ClampedArray(4) });
  expect(mock.dispose).toHaveBeenCalledOnce();
  expect(listener).not.toHaveBeenCalled();
  frames.captureScopes(canvas);
  expect(mock.capture).toHaveBeenCalledTimes(1);
});

it("recreates readback after context restore and ignores pre-loss delivery", async () => {
  const frames = await import("../frames");
  const listener = vi.fn();
  const stop = frames.subscribeFrames(listener);
  frames.captureScopes(canvas);
  const staleGeneration = 1;
  canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  mock.capture.mock.calls[0]![0]({ pixels: new Uint8ClampedArray(4) });
  expect(listener).not.toHaveBeenCalled();
  raf.shift()!(0);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  frames.captureScopes(canvas);
  expect(mock.capture).toHaveBeenCalledTimes(2);
  expect(frames.releaseFrame(undefined, staleGeneration)).toBe(false);
  mock.capture.mock.calls[1]![0]({ pixels: new Uint8ClampedArray(4) });
  expect(listener).toHaveBeenCalledOnce();
  stop();
});
