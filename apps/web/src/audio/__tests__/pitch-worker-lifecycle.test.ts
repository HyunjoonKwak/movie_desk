import { type MediaClip, type StretchRequest, newId, renderClipAudio } from "@movie-desk/core";
import { afterEach, expect, it, vi } from "vitest";
let renderPitchInWorker: typeof import("../pitch-renderer").renderPitchInWorker;
import { beforeEach } from "vitest";
beforeEach(async () => {
  vi.resetModules();
  ({ renderPitchInWorker } = await import("../pitch-renderer"));
});

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

it.each([false, true])(
  "cropped source matches full DSP with nonzero offset (trim/ramp: %s)",
  async (ramp) => {
    let cropped: Float32Array[] = [];
    vi.stubGlobal(
      "Worker",
      class {
        onmessage = (_event: unknown) => {};
        terminate() {}
        postMessage(req: StretchRequest) {
          cropped = renderClipAudio(req).channels;
          this.onmessage({ data: { channels: cropped } });
        }
      },
    );
    const req = {
      ...request(4),
      clip: ramp
        ? {
            ...clip,
            trimIn: 500,
            trimOut: 4000,
            duration: 3000,
            keyframes: [
              {
                target: "speed",
                keyframes: [
                  { at: 0, value: 0.5, easing: "linear" as const },
                  { at: 3000, value: 1.5, easing: "linear" as const },
                ],
              },
            ],
          }
        : clip,
      offsetMs: 2000,
      outputSamples: 48000,
      channels: [
        Float32Array.from({ length: 4 * 48000 }, (_, i) =>
          Math.sin((i * 2 * Math.PI * 440) / 48000),
        ),
      ],
    };
    const full = renderClipAudio(req).channels;
    await renderPitchInWorker(req);
    expect(cropped).toEqual(full);
  },
);

it("reuses two workers across queued jobs and later renders", async () => {
  const workers: { onmessage: (event: unknown) => void; terminate: ReturnType<typeof vi.fn> }[] =
    [];
  vi.stubGlobal(
    "Worker",
    class {
      onmessage = (_event: unknown) => {};
      terminate = vi.fn();
      postMessage() {}
      constructor() {
        workers.push(this);
      }
    },
  );
  const jobs = [
    renderPitchInWorker(request()),
    renderPitchInWorker(request()),
    renderPitchInWorker(request()),
  ];
  await vi.waitFor(() => expect(workers).toHaveLength(2));
  workers[0]!.onmessage({ data: { channels: [] } });
  await jobs[0];
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(workers).toHaveLength(2);
  workers[0]!.onmessage({ data: { channels: [] } });
  workers[1]!.onmessage({ data: { channels: [] } });
  await Promise.all(jobs);
  expect(workers.every((w) => w.terminate.mock.calls.length === 0)).toBe(true);
});
it("does not emit timing measures in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const measure = vi.spyOn(performance, "measure");
  const { pitchMainSlice } = await import("../pitch-renderer");
  expect(pitchMainSlice(() => 42)).toBe(42);
  expect(measure).not.toHaveBeenCalled();
  measure.mockRestore();
  vi.unstubAllEnvs();
});

it("carries DSP checkpoints through pooled workers and cropped consecutive chunks", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      onmessage = (_event: unknown) => {};
      terminate() {}
      postMessage(req: StretchRequest) {
        this.onmessage({ data: renderClipAudio(req) });
      }
    },
  );
  const channels = [
    Float32Array.from(
      { length: 4 * 48000 },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 443 * i) / 48000),
    ),
  ];
  const req = {
    ...request(4),
    channels,
    clip: { ...clip, speed: 1.37, duration: 2000, trimOut: 4000 },
    outputSamples: 48000,
  };
  const whole = renderClipAudio({ ...req, outputSamples: 96000 }).channels;
  const { renderPitchRangeInWorker } = await import("../pitch-renderer");
  const first = await renderPitchRangeInWorker(req);
  const a = first.channels;
  // An unrelated preview render cannot replace export state.
  await renderPitchInWorker({ ...req, offsetMs: 500 });
  const b = (
    await renderPitchRangeInWorker({ ...req, offsetMs: 1000, continuation: first.continuation! })
  ).channels;
  expect(a[0]).toEqual(whole[0]!.subarray(0, 48000));
  expect(b[0]).toEqual(whole[0]!.subarray(48000));
  expect(Math.abs(b[0]![0]! - a[0]!.at(-1)!)).toBeLessThan(0.05);
});
it("removes aborted queued jobs without creating another worker", async () => {
  const workers: { onmessage: (event: unknown) => void }[] = [];
  vi.stubGlobal(
    "Worker",
    class {
      onmessage = (_event: unknown) => {};
      postMessage() {}
      terminate() {}
      constructor() {
        workers.push(this);
      }
    },
  );
  const a = renderPitchInWorker(request());
  const b = renderPitchInWorker(request());
  await vi.waitFor(() => expect(workers).toHaveLength(2));
  const controller = new AbortController();
  const queued = expect(renderPitchInWorker(request(), controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await queued;
  for (const worker of workers) worker.onmessage({ data: { channels: [] } });
  await Promise.all([a, b]);
  expect(workers).toHaveLength(2);
});

it("disposes pooled workers and retires in-flight workers after disposal", async () => {
  const workers: { onmessage: (event: unknown) => void; terminate: ReturnType<typeof vi.fn> }[] =
    [];
  vi.stubGlobal(
    "Worker",
    class {
      onmessage = (_event: unknown) => {};
      terminate = vi.fn();
      postMessage() {}
      constructor() {
        workers.push(this);
      }
    },
  );
  const { disposePitchWorkers } = await import("../pitch-renderer");
  const a = renderPitchInWorker(request());
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  disposePitchWorkers();
  workers[0]!.onmessage({ data: { channels: [] } });
  await a;
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  const b = renderPitchInWorker(request());
  await vi.waitFor(() => expect(workers).toHaveLength(2));
  workers[1]!.onmessage({ data: { channels: [] } });
  await b;
  disposePitchWorkers();
  expect(workers[1]!.terminate).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "cropped padded checkpoints match uninterrupted DSP (ramp: %s)",
  async (ramp) => {
    const starts: number[] = [];
    vi.stubGlobal(
      "Worker",
      class {
        onmessage = (_event: unknown) => {};
        terminate() {}
        postMessage(req: StretchRequest) {
          starts.push(req.sourceStartSample ?? 0);
          this.onmessage({ data: renderClipAudio(req) });
        }
      },
    );
    const sr = 48000;
    const channels = [0.4, 0.2].map((amplitude) =>
      Float32Array.from(
        { length: 6 * sr },
        (_, i) =>
          amplitude *
          (Math.sin((2 * Math.PI * 443 * i) / sr) + 0.2 * Math.sin((2 * Math.PI * 6011 * i) / sr)),
      ),
    );
    const req: StretchRequest = {
      ...request(6),
      channels,
      clip: {
        ...clip,
        trimIn: 500,
        trimOut: 6000,
        duration: 3000,
        speed: 1.37,
        keyframes: ramp
          ? [
              {
                target: "speed",
                keyframes: [
                  { at: 0, value: 0.5, easing: "linear" },
                  { at: 3000, value: 1.5, easing: "linear" },
                ],
              },
            ]
          : [],
      },
      outputSamples: 3 * sr,
    };
    const whole = renderClipAudio(req).channels;
    const { renderPitchRangeInWorker } = await import("../pitch-renderer");
    const padding = 4800;
    let continuation: StretchRequest["continuation"];
    for (let chunk = 0; chunk < 3; chunk++) {
      const start = chunk * sr;
      const paddedStart = Math.max(0, start - padding);
      const end = Math.min(3 * sr, start + sr + padding);
      const result = await renderPitchRangeInWorker({
        ...req,
        offsetMs: (paddedStart * 1000) / sr,
        outputSamples: end - paddedStart,
        checkpointSample: start + sr - padding,
        ...(continuation ? { continuation } : {}),
      });
      continuation = result.continuation;
      expect(continuation?.nextStartSample).toBe(start + sr - padding);
      for (let c = 0; c < 2; c++) {
        const actual = result.channels[c]!.subarray(start - paddedStart, start - paddedStart + sr);
        const expected = whole[c]!.subarray(start, start + sr);
        expect(actual.every((sample, i) => sample === expected[i])).toBe(true);
      }
      await renderPitchInWorker({ ...req, offsetMs: 250, outputSamples: 480 });
    }
    expect(starts.some((start) => start > sr)).toBe(true);
  },
);
