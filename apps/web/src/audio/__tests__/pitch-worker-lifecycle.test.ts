import { afterEach, expect, it, vi } from "vitest";
import { newId, renderClipAudio, type MediaClip, type StretchRequest } from "@movie-desk/core";
import { renderPitchInWorker } from "../pitch-renderer";

const clip: MediaClip = {
  id: newId(),
  assetId: newId(),
  kind: "media",
  start: 0,
  duration: 60000,
  trimIn: 0,
  trimOut: 60000,
  speed: 1,
  preservePitch: true,
  keyframes: [],
  effects: [],
};
const request = (seconds = 1): StretchRequest => ({
  channels: [new Float32Array(seconds * 48000)],
  clip,
  sourceSampleRate: 48000,
  outputSampleRate: 48000,
  offsetMs: 0,
  outputSamples: 480,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("transfers at most twice a 60s stereo asset over six export chunks", async () => {
  let bytes = 0;
  const post = vi.fn(function (this: { onmessage: (event: unknown) => void }, req: StretchRequest) {
    bytes += req.channels.reduce((sum, c) => sum + c.byteLength, 0);
    this.onmessage({ data: { channels: [] } });
  });
  vi.stubGlobal(
    "Worker",
    class {
      postMessage = post;
      terminate() {}
    },
  );
  const channels = [new Float32Array(60 * 48000), new Float32Array(60 * 48000)];
  for (let i = 0; i < 6; i++)
    await renderPitchInWorker({
      ...request(),
      channels,
      offsetMs: i * 10000,
      outputSamples: 10 * 48000,
    });
  expect(post).toHaveBeenCalledTimes(6);
  expect(bytes).toBeLessThanOrEqual(channels[0]!.byteLength * 4);
});

it.each(["missing", "CSP", "error", "timeout"])("rejects %s worker failures", async (mode) => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "Worker",
    mode === "missing"
      ? undefined
      : class {
          onerror = () => {};
          constructor() {
            if (mode === "CSP") throw new Error("CSP");
          }
          postMessage() {
            if (mode === "error") this.onerror();
          }
          terminate() {}
        },
  );
  const result = expect(renderPitchInWorker(request())).rejects.toThrow();
  await vi.runAllTimersAsync();
  await result;
});

it("terminates aborted DSP and starts a replacement without waiting for its reply", async () => {
  const workers: { terminate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }[] =
    [];
  vi.stubGlobal(
    "Worker",
    class {
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        workers.push(this);
      }
    },
  );
  const first = new AbortController();
  const old = expect(renderPitchInWorker(request(), first.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  first.abort();
  const next = new AbortController();
  const fresh = expect(renderPitchInWorker(request(), next.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(workers).toHaveLength(2));
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  next.abort();
  await Promise.all([old, fresh]);
});

it("cropped source offsets reproduce full-source DSP at a nonzero chunk offset", async () => {
  let cropped: Float32Array[] = [];
  vi.stubGlobal(
    "Worker",
    class {
      onmessage = (_event: unknown) => {};
      terminate() {}
      postMessage(req: StretchRequest) {
        cropped = renderClipAudio(req);
        this.onmessage({ data: { channels: cropped } });
      }
    },
  );
  const req = {
    ...request(4),
    offsetMs: 2000,
    outputSamples: 48000,
    channels: [
      Float32Array.from({ length: 4 * 48000 }, (_, i) => Math.sin((i * 2 * Math.PI * 440) / 48000)),
    ],
  };
  const full = renderClipAudio(req);
  await renderPitchInWorker(req);
  expect(cropped).toEqual(full);
});
