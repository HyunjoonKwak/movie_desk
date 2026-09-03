import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedMp4 } from "../mp4-demux";
import { type FakeFrame, installFakeWebCodecs, openedFixture } from "./webcodecs-fakes";

// The WebCodecs path of the sampler over the fake decoder: frames are drawn
// once, and a sink that rejects ends the pass without the sampler touching a
// frame the decoder has closed for it.

const fixture = vi.hoisted(() => ({ opened: null as OpenedMp4 | null }));

vi.mock("../mp4-demux", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mp4-demux")>()),
  openMp4: async () => fixture.opened,
  syncSampleTimesMs: () => [0],
}));
vi.mock("../mp4-decoder", () => ({ toByteSource: (input: unknown) => input }));

import { streamFramesAt } from "../frame-sampler";

const drawn: number[] = [];

const fakeCanvas = () => ({
  width: 0,
  height: 0,
  getContext: () => ({
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    drawImage: (frame: FakeFrame) => {
      // A real canvas raises InvalidStateError for a closed VideoFrame.
      if (frame.closed > 0) throw new Error("closed frame drawn");
      drawn.push(frame.timestamp);
    },
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ width, height }),
  }),
});

// The media-element fallback cannot run in node; it fails fast on `src`.
const fakeVideo = () => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    pause() {},
    removeAttribute() {},
    load() {},
    set src(_value: string) {
      queueMicrotask(() => {
        for (const fn of listeners.get("error") ?? []) fn();
      });
    },
  };
};

const input = new Blob([new Uint8Array(400)], { type: "video/mp4" });
const size = { width: 4, height: 4 };

beforeEach(() => {
  drawn.length = 0;
  fixture.opened = openedFixture();
  vi.stubGlobal("document", {
    createElement: (tag: string) => (tag === "canvas" ? fakeCanvas() : fakeVideo()),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamFramesAt over WebCodecs", () => {
  it("serves every requested time from one linear pass, in order", async () => {
    const frames = installFakeWebCodecs("flush");
    const served: number[] = [];
    await streamFramesAt(input, [0, 40, 80, 120], { size }, ({ atMs }) => {
      served.push(atMs);
    });

    expect(served).toEqual([0, 40, 80, 120]);
    expect(drawn).toEqual([0, 40_000, 80_000, 120_000]);
    expect(frames.map((f) => f.closed)).toEqual([1, 1, 1, 1]);
  });

  it("ends the pass on a rejecting sink without drawing the frame the decoder closed", async () => {
    const frames = installFakeWebCodecs("flush");
    let calls = 0;
    const pass = streamFramesAt(input, [0, 40, 80, 120], { size }, async () => {
      calls += 1;
      throw new Error("encoder failed");
    });

    // WebCodecs served nothing, so the sampler moved on to the fallback.
    await expect(pass).rejects.toThrow("video metadata load failed");
    expect(calls).toBe(1);
    expect(drawn).toEqual([0]);
    expect(frames.every((f) => f.closed >= 1)).toBe(true);
  });
});
