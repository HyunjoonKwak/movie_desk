import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The frame provider keeps one demuxer + decoder per prepared asset. This
// checks the bound: least recently used handles are closed once the limit is
// passed, a touched handle survives, and an evicted asset can be prepared
// again on demand.

const opened: string[] = [];
const closed: string[] = [];

vi.mock("../mp4-decoder", () => ({
  UnsupportedCodecError: class extends Error {},
  decodeMp4ToCache: async (_input: unknown, assetId: string) => {
    opened.push(assetId);
    return {
      assetId,
      duration: 1_000_000,
      width: 16,
      height: 16,
      request: async () => {},
      close: () => {
        closed.push(assetId);
      },
    };
  },
}));

import { createFrameProviderForTests } from "../webcodecs-decoder";

const source = new Blob([new Uint8Array(8)]);

beforeEach(() => {
  opened.length = 0;
  closed.length = 0;
  vi.stubGlobal("window", { VideoDecoder: class {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CachingFrameProvider handle bound", () => {
  it("closes the least recently used handle once more than the limit are prepared", async () => {
    const provider = createFrameProviderForTests(2);
    expect(await provider.prepare("a", source)).toBe(true);
    expect(await provider.prepare("b", source)).toBe(true);
    // Touching "a" makes "b" the oldest.
    provider.framesFor("a", 0);
    expect(await provider.prepare("c", source)).toBe(true);

    expect(closed).toEqual(["b"]);
    expect(provider.has("a")).toBe(true);
    expect(provider.has("b")).toBe(false);
    expect(provider.has("c")).toBe(true);
  });

  it("prepares an evicted asset again instead of treating it as ready", async () => {
    const provider = createFrameProviderForTests(1);
    await provider.prepare("a", source);
    await provider.prepare("b", source);
    expect(provider.has("a")).toBe(false);
    expect(await provider.prepare("a", source)).toBe(true);
    expect(opened).toEqual(["a", "b", "a"]);
    expect(closed).toEqual(["a", "b"]);
  });

  it("does not open a second handle for an asset that already has one", async () => {
    const provider = createFrameProviderForTests(4);
    await provider.prepare("a", source);
    await provider.prepare("a", source);
    expect(opened).toEqual(["a"]);
    provider.dispose();
    expect(closed).toEqual(["a"]);
  });
});
