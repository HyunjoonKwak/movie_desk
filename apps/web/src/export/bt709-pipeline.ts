import { readTargetPixels } from "@/renderer/read-target";
import type { RenderTarget } from "@/renderer/render-target";
import { BT709_COLOR_SPACE, Bt709FrameCapture } from "./bt709-frame";
import { createBt709Worker } from "./bt709-worker-factory";

interface Slot {
  rgba: ArrayBuffer;
  yuv: ArrayBuffer;
}
interface Pending {
  resolve: (frame: VideoFrame) => void;
  reject: (error: Error) => void;
  timestamp: number;
  duration: number;
  timer: ReturnType<typeof setTimeout>;
}

// Two reusable slots: render/read frame N+1 while the worker converts N and the
// encoder consumes N-1. The caller drains in order; completion order never
// becomes timestamp order. No more than two frames can be submitted here.
export class Bt709FramePipeline {
  private readonly worker: Worker | null;
  private readonly synchronous: Bt709FrameCapture | null;
  private slots: Slot[] = [];
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private stopped = false;
  private readonly abort = () => this.dispose();
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly signal?: AbortSignal,
  ) {
    let worker: Worker | null = null;
    try {
      if (typeof Worker !== "undefined") worker = createBt709Worker();
    } catch {
      /* Explicit synchronous fallback. */
    }
    this.worker = worker;
    this.synchronous = worker ? null : new Bt709FrameCapture(canvas);
    if (worker) {
      const size = canvas.width * canvas.height;
      this.slots = Array.from({ length: 2 }, () => ({
        rgba: new ArrayBuffer(size * 4),
        yuv: new ArrayBuffer((size * 3) / 2),
      }));
      worker.onmessage = (event: MessageEvent<Slot & { id: number; error?: string }>) => {
        const request = this.pending.get(event.data.id);
        if (!request) return;
        this.pending.delete(event.data.id);
        clearTimeout(request.timer);
        const { rgba, yuv, error } = event.data;
        this.slots.push({ rgba, yuv });
        if (error) {
          request.reject(new Error(`Color conversion failed: ${error}`));
          return;
        }
        try {
          request.resolve(
            new VideoFrame(yuv, {
              format: "I420",
              codedWidth: canvas.width,
              codedHeight: canvas.height,
              timestamp: request.timestamp,
              duration: request.duration,
              colorSpace: BT709_COLOR_SPACE,
            }),
          );
        } catch (error) {
          request.reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      worker.onerror = () => this.fail(new Error("Color conversion worker failed"));
      worker.onmessageerror = () =>
        this.fail(new Error("Color conversion worker response could not be read"));
    }
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.dispose();
  }
  capture(timestamp: number, duration: number, target?: RenderTarget): Promise<VideoFrame> {
    if (this.stopped) return Promise.reject(new Error("Color conversion stopped"));
    if (this.synchronous) return Promise.resolve(this.synchronous.capture(timestamp, duration, target));
    const slot = this.slots.pop();
    if (!slot) return Promise.reject(new Error("Color conversion queue is full"));
    const gl = this.canvas.getContext("webgl2");
    if (!gl || gl.isContextLost()) {
      this.slots.push(slot);
      return Promise.reject(new Error("Export color readback is unavailable"));
    }
    try {
      readTargetPixels(gl, this.canvas.width, this.canvas.height, new Uint8Array(slot.rgba), target);
    } catch (error) {
      this.slots.push(slot);
      return Promise.reject(error);
    }
    const id = this.sequence++;
    const result = new Promise<VideoFrame>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("Color conversion timed out")), 30000);
      this.pending.set(id, { resolve, reject, timestamp, duration, timer });
      try {
        this.worker!.postMessage(
          { id, ...slot, width: this.canvas.width, height: this.canvas.height },
          [slot.rgba, slot.yuv],
        );
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    // A later frame may fail before its turn to drain; keep that rejection
    // handled while preserving it on the original promise for the exporter.
    void result.catch(() => {});
    return result;
  }
  private fail(error: Error) {
    this.stopped = true;
    this.worker?.terminate();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.slots = [];
  }
  dispose() {
    this.signal?.removeEventListener("abort", this.abort);
    this.fail(new Error("Color conversion stopped"));
  }
}
