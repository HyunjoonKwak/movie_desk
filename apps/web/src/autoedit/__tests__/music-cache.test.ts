import type { ID } from "@movie-desk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), beats: vi.fn(), decode: vi.fn() }));
vi.mock("@/persistence/opfs", () => ({ readMediaFile: mocks.read }));
vi.mock("@/ai/beat-detect", () => ({ detectBeatsFromBlob: mocks.beats }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(new Blob([new Uint8Array([1])]));
  mocks.beats.mockResolvedValue([0, 500, 1000]);
  mocks.decode.mockResolvedValue({
    sampleRate: 4,
    getChannelData: () => new Float32Array([0.1, 0.2, 0.1, 0.2]),
  });
  vi.stubGlobal("window", {
    OfflineAudioContext: class {
      decodeAudioData = mocks.decode;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("shared music analysis", () => {
  it("coalesces concurrent panel/generation calls and later tab remounts", async () => {
    const { analyzeMusic } = await import("../music");
    const first = analyzeMusic({ id: "music" as ID, opfsPath: "source.mp3", durationMs: 300000 });
    expect(analyzeMusic({ id: "music" as ID, opfsPath: "source.mp3", durationMs: 300000 })).toBe(
      first,
    );
    const result = await first;
    expect(result?.bpm).toBe(120);
    expect(
      await analyzeMusic({ id: "music" as ID, opfsPath: "source.mp3", durationMs: 300000 }),
    ).toBe(result);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.beats).toHaveBeenCalledTimes(1);
    expect(mocks.decode).toHaveBeenCalledTimes(1);
  });
  it("keys by both asset id and source path", async () => {
    const { analyzeMusic } = await import("../music");
    await analyzeMusic({ id: "one" as ID, opfsPath: "old.mp3", durationMs: 1000 });
    await analyzeMusic({ id: "one" as ID, opfsPath: "new.mp3", durationMs: 1000 });
    await analyzeMusic({ id: "two" as ID, opfsPath: "new.mp3", durationMs: 1000 });
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });
  it("retries a missing file instead of caching null", async () => {
    const { analyzeMusic } = await import("../music");
    mocks.read.mockResolvedValueOnce(null);
    expect(
      await analyzeMusic({ id: "music" as ID, opfsPath: "source.mp3", durationMs: 1000 }),
    ).toBeNull();
    expect(
      await analyzeMusic({ id: "music" as ID, opfsPath: "source.mp3", durationMs: 1000 }),
    ).not.toBeNull();
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it("evicts rejected reads and failed decodes", async () => {
    const { analyzeMusic } = await import("../music");
    mocks.read.mockRejectedValueOnce(new Error("offline"));
    expect(
      await analyzeMusic({ id: "music" as ID, opfsPath: "source.mp3", durationMs: 1000 }),
    ).toBeNull();
    mocks.decode.mockRejectedValueOnce(new Error("decoder"));
    expect(
      await analyzeMusic({ id: "music" as ID, opfsPath: "source.mp3", durationMs: 1000 }),
    ).toBeNull();
    expect(
      await analyzeMusic({ id: "music" as ID, opfsPath: "source.mp3", durationMs: 1000 }),
    ).not.toBeNull();
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });
  it("reanalyzes relinked bytes or duration at the same id and path", async () => {
    const { analyzeMusic } = await import("../music");
    const source = { id: "same" as ID, opfsPath: "same.mp3", sizeBytes: 100, durationMs: 1000 };
    const first = await analyzeMusic(source);
    mocks.beats.mockResolvedValue([0, 1000, 2000]);
    const resized = await analyzeMusic({ ...source, sizeBytes: 200 });
    const longer = await analyzeMusic({ ...source, sizeBytes: 200, durationMs: 2000 });
    expect(first?.bpm).toBe(120);
    expect(resized?.bpm).toBe(60);
    expect(longer?.durationMs).toBe(2000);
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });
  it("retains only four recently used sources across projects", async () => {
    const { analyzeMusic } = await import("../music");
    const source = (id: string) => ({ id: id as ID, opfsPath: id, durationMs: 1000 });
    for (const id of ["a", "b", "c", "d"]) await analyzeMusic(source(id));
    await analyzeMusic(source("a"));
    await analyzeMusic(source("e"));
    await analyzeMusic(source("a"));
    expect(mocks.read).toHaveBeenCalledTimes(5);
    await analyzeMusic(source("b"));
    expect(mocks.read).toHaveBeenCalledTimes(6);
  });
});
