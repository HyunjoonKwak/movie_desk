import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameSampleOptions, SampleTimes, SampledImage } from "@/renderer/frame-sampler";

const mocks = vi.hoisted(() => ({
  sampleFramesAt:
    vi.fn<
      (input: unknown, times: SampleTimes, options: FrameSampleOptions) => Promise<SampledImage[]>
    >(),
}));

vi.mock("@/renderer/frame-sampler", () => ({ sampleFramesAt: mocks.sampleFramesAt }));

import { makeVideoFilmstrip } from "../thumbnail";

interface FakeCanvas {
  width: number;
  height: number;
  readonly puts: Array<readonly [number, number]>;
  getContext(): { putImageData: (image: unknown, x: number, y: number) => void };
  toDataURL(): string;
}

const canvases: FakeCanvas[] = [];

const fakeDocument = {
  createElement: (): FakeCanvas => {
    const canvas: FakeCanvas = {
      width: 0,
      height: 0,
      puts: [],
      getContext: () => ({
        putImageData: (_image, x, y) => {
          canvas.puts.push([x, y]);
        },
      }),
      toDataURL: () => `data:image/webp;base64,${canvas.width}x${canvas.height}`,
    };
    canvases.push(canvas);
    return canvas;
  },
};

// Mirrors the real sampler's contract: requested times are de-duplicated, so
// a clip shorter than the tile count yields fewer samples than requested.
const sortedUnique = (times: readonly number[]): number[] =>
  [...new Set(times.map((t) => Math.max(0, t)))].sort((a, b) => a - b);

const useSampler = (durationMs: number, width = 1920, height = 1080): void => {
  mocks.sampleFramesAt.mockImplementation(async (_input, times, options) => {
    const requested = typeof times === "function" ? times(durationMs) : times;
    const size = typeof options.size === "function" ? options.size(width, height) : options.size;
    return sortedUnique(requested).map((atMs) => ({
      atMs,
      image: { width: size.width, height: size.height } as unknown as ImageData,
    }));
  });
};

const file = new File([new Uint8Array(8)], "clip.mp4", { type: "video/mp4" });
// 48 px tall tiles from a 16:9 source.
const TILE_W = 85;

beforeEach(() => {
  canvases.length = 0;
  vi.stubGlobal("document", fakeDocument);
});

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.sampleFramesAt.mockReset();
});

describe("makeVideoFilmstrip", () => {
  it("draws ten evenly spaced tiles for a clip long enough to hold them", async () => {
    useSampler(60_000);
    const strip = await makeVideoFilmstrip(file, 10);

    expect(strip).toEqual({ dataUrl: `data:image/webp;base64,${TILE_W * 10}x48`, frames: 10 });
    expect(canvases[0]?.puts.map(([x]) => x)).toEqual(
      Array.from({ length: 10 }, (_, i) => i * TILE_W),
    );
  });

  it("sizes the strip by the frames actually sampled for a very short clip", async () => {
    // 120 ms: the last four segment centres all clamp to 70 ms, so the
    // sampler returns seven frames for ten requests.
    useSampler(120);
    const strip = await makeVideoFilmstrip(file, 10);

    expect(strip).toEqual({ dataUrl: `data:image/webp;base64,${TILE_W * 7}x48`, frames: 7 });
    expect(canvases[0]?.width).toBe(TILE_W * 7);
    expect(canvases[0]?.puts).toHaveLength(7);
    expect(canvases[0]?.puts.at(-1)).toEqual([TILE_W * 6, 0]);
  });

  it("collapses to a single tile when the duration is unknown", async () => {
    useSampler(0);
    const strip = await makeVideoFilmstrip(file, 10);

    expect(strip).toEqual({ dataUrl: `data:image/webp;base64,${TILE_W}x48`, frames: 1 });
    expect(canvases[0]?.puts).toEqual([[0, 0]]);
  });

  it("returns null when nothing could be sampled", async () => {
    mocks.sampleFramesAt.mockResolvedValue([]);
    expect(await makeVideoFilmstrip(file, 10)).toBeNull();
    expect(canvases).toHaveLength(0);
  });
});
