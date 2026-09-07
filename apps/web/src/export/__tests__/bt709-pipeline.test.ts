import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rgbaToBt709I420 } from "../bt709-frame";
import { Bt709FramePipeline } from "../bt709-pipeline";
const factory = vi.hoisted(() => ({ worker: null as unknown as Worker }));
vi.mock("../bt709-worker-factory", () => ({ createBt709Worker: () => factory.worker }));
interface Job {
  id: number;
  width: number;
  height: number;
  rgba: ArrayBuffer;
  yuv: ArrayBuffer;
}
class FakeWorker {
  jobs: Job[] = [];
  onmessage: ((event: MessageEvent<Job>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage(job: Job, transfer: Transferable[]) {
    this.jobs.push(structuredClone(job, { transfer }));
  }
  reply(index: number) {
    const job = this.jobs.splice(index, 1)[0]!;
    rgbaToBt709I420(new Uint8Array(job.rgba), job.width, job.height, new Uint8Array(job.yuv), true);
    this.onmessage?.({
      data: structuredClone(job, { transfer: [job.rgba, job.yuv] }),
    } as MessageEvent<Job>);
  }
}
class Frame {
  readonly bytes: Uint8Array;
  readonly timestamp: number;
  close = vi.fn();
  constructor(data: ArrayBuffer, init: { timestamp: number }) {
    this.bytes = new Uint8Array(data).slice();
    this.timestamp = init.timestamp;
  }
}
let worker: FakeWorker;
let gray = 255;
const canvas = {
  width: 2,
  height: 2,
  getContext: () => ({
    FRAMEBUFFER: 1,
    RGBA: 2,
    UNSIGNED_BYTE: 3,
    isContextLost: () => false,
    bindFramebuffer() {},
    readPixels: (
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      _format: number,
      _type: number,
      dst: Uint8Array,
    ) => {
      dst.fill(gray);
      for (let i = 3; i < dst.length; i += 4) dst[i] = 255;
    },
  }),
} as unknown as HTMLCanvasElement;
beforeEach(() => {
  worker = new FakeWorker();
  factory.worker = worker as unknown as Worker;
  gray = 255;
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("VideoFrame", Frame);
});
afterEach(() => vi.unstubAllGlobals());
it("bounds transferred buffers and preserves timestamps despite reversed replies", async () => {
  const pipeline = new Bt709FramePipeline(canvas);
  const first = pipeline.capture(0, 33333);
  gray = 0;
  const second = pipeline.capture(33333, 33333);
  await expect(pipeline.capture(66666, 33333)).rejects.toThrow("queue is full");
  worker.reply(1);
  const b = (await second) as unknown as Frame;
  expect(b.timestamp).toBe(33333);
  expect(b.bytes[0]).toBe(16);
  worker.reply(0);
  const a = (await first) as unknown as Frame;
  expect(a.timestamp).toBe(0);
  expect(a.bytes[0]).toBe(235);
  const third = pipeline.capture(66666, 33333);
  worker.reply(0);
  await third;
  expect(a.bytes[0]).toBe(235); // A recycled transport buffer cannot change an owned frame.
  pipeline.dispose();
});
it("aborts pending conversion and ignores late responses", async () => {
  const controller = new AbortController();
  const pipeline = new Bt709FramePipeline(canvas, controller.signal);
  const pending = pipeline.capture(0, 33333);
  controller.abort();
  await expect(pending).rejects.toThrow("stopped");
  worker.reply(0);
  expect(worker.terminate).toHaveBeenCalled();
});
it("rejects worker failure and provides a synchronous path without Worker", async () => {
  const pipeline = new Bt709FramePipeline(canvas);
  const pending = pipeline.capture(0, 33333);
  worker.onerror?.();
  await expect(pending).rejects.toThrow("worker failed");
  pipeline.dispose();
  vi.stubGlobal("Worker", undefined);
  const fallback = new Bt709FramePipeline(canvas);
  const frame = (await fallback.capture(9, 33333)) as unknown as Frame;
  expect(frame.timestamp).toBe(9);
  expect(frame.bytes[0]).toBe(235);
  fallback.dispose();
});
