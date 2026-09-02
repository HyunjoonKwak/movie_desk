import { describe, expect, it } from "vitest";
import { frameDecodeWindow } from "../mp4-decoder";

describe("frameDecodeWindow", () => {
  it("keeps a bounded look-behind and look-ahead around the playhead", () => {
    expect(frameDecodeWindow(2_000_000)).toEqual({
      startUs: 1_880_000,
      endUs: 2_650_000,
    });
  });

  it("does not request negative media time near the beginning", () => {
    expect(frameDecodeWindow(50_000).startUs).toBe(0);
  });
});

// The demuxer reads ranges through a ByteSource so a Blob (legacy OPFS copy)
// and a RandomAccessMediaSource (disk reference) look identical to mp4box.
describe("toByteSource", () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  it("wraps a Blob and stamps fileStart on every chunk", async () => {
    const { toByteSource } = await import("../mp4-decoder");
    const source = toByteSource(new Blob([payload]));
    expect(source.size).toBe(8);
    const chunk = await source.read(2, 3);
    expect(Array.from(new Uint8Array(chunk))).toEqual([3, 4, 5]);
    expect(chunk.fileStart).toBe(2);
  });

  it("delegates to a RandomAccessMediaSource without copying the whole file", async () => {
    const { toByteSource } = await import("../mp4-decoder");
    const reads: [number, number][] = [];
    const source = toByteSource({
      assetId: "a",
      sizeBytes: 8,
      mime: "video/mp4",
      read: async (start, length) => {
        reads.push([start, length]);
        return payload.slice(start, start + length).buffer;
      },
      acquirePlaybackUrl: async () => ({ url: "", release() {} }),
    });
    const chunk = await source.read(4, 100);
    expect(Array.from(new Uint8Array(chunk))).toEqual([5, 6, 7, 8]);
    expect(chunk.fileStart).toBe(4);
    expect(reads).toEqual([[4, 4]]); // clamped before it reaches the adapter
  });
});
