import { afterEach, expect, it, vi } from "vitest";
import type { RenderTarget } from "@/renderer/render-target";
import { Bt709FrameCapture } from "../bt709-frame";
import { Bt709FramePipeline } from "../bt709-pipeline";

const state = vi.hoisted(() => ({ worker: null as unknown as Worker }));
vi.mock("../bt709-worker-factory", () => ({ createBt709Worker: () => state.worker }));
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const target: RenderTarget = { fbo: {}, width: 2, height: 2, clearAlpha: 1 };
  const previousRead = {};
  const previousDraw = {};
  let read = previousRead;
  let draw = previousDraw;
  const gl = {
    READ_FRAMEBUFFER: 1, DRAW_FRAMEBUFFER: 2, FRAMEBUFFER: 3,
    READ_FRAMEBUFFER_BINDING: 4, RGBA: 5, UNSIGNED_BYTE: 6,
    isContextLost: () => false,
    getParameter: () => read,
    bindFramebuffer: (binding: number, value: object) => {
      if (binding === 1 || binding === 3) read = value;
      if (binding === 2 || binding === 3) draw = value;
    },
    readPixels: vi.fn((_x, _y, _w, _h, _format, _type, pixels: Uint8Array) => {
      expect(read).toBe(target.fbo);
      pixels.fill(255);
    }),
  };
  const canvas = { width: 2, height: 2, getContext: () => gl } as unknown as HTMLCanvasElement;
  const assertRestored = () => {
    expect(read).toBe(previousRead);
    expect(draw).toBe(previousDraw);
  };
  return { target, gl, canvas, assertRestored };
}

it("restores split bindings before the asynchronous conversion worker owns the frame", async () => {
  const fixture = setup();
  const worker = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn((job) => {
      fixture.assertRestored();
      queueMicrotask(() => worker.onmessage?.({ data: job } as MessageEvent));
    }),
    terminate: vi.fn(),
  };
  state.worker = worker as unknown as Worker;
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("VideoFrame", class {});
  const pipeline = new Bt709FramePipeline(fixture.canvas);
  await pipeline.capture(0, 33333, fixture.target);
  fixture.assertRestored();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  pipeline.dispose();
});

it("restores a failed read and returns its pipeline slot for the next capture", async () => {
  const fixture = setup();
  const worker = { postMessage: vi.fn(), terminate: vi.fn() };
  state.worker = worker as unknown as Worker;
  vi.stubGlobal("Worker", class {});
  const pipeline = new Bt709FramePipeline(fixture.canvas);
  fixture.gl.readPixels.mockImplementationOnce(() => { throw new Error("read failed"); });
  await expect(pipeline.capture(0, 33333, fixture.target)).rejects.toThrow("read failed");
  fixture.assertRestored();
  const first = pipeline.capture(1, 33333, fixture.target);
  const second = pipeline.capture(2, 33333, fixture.target);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  pipeline.dispose();
  await expect(first).rejects.toThrow("stopped");
  await expect(second).rejects.toThrow("stopped");
});

it("restores the synchronous export read binding when readPixels throws", () => {
  const fixture = setup();
  fixture.gl.readPixels.mockImplementationOnce(() => { throw new Error("read failed"); });
  expect(() => new Bt709FrameCapture(fixture.canvas).capture(0, 1, fixture.target)).toThrow("read failed");
  fixture.assertRestored();
});
