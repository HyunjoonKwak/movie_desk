import { audioVariantKey } from "@/media/audio/audio-variant";
import { type ID, createEmptyProject } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { referencedMediaKeys } from "../media-gc";

// Cache variants are rebuildable, but reaping one every startup would make
// the next play or export rebuild it. GC keeps the variant of every asset a
// project still references and lets orphans go with the original.
describe("referencedMediaKeys", () => {
  it("keeps originals, proxies and the audio variant of referenced assets", () => {
    const asset = {
      id: "a1" as ID,
      name: "clip.mp4",
      kind: "video" as const,
      mime: "video/mp4",
      durationMs: 1000,
      opfsPath: "orig.mp4",
      proxyPath: "proxy.mp4",
      sizeBytes: 123,
      importedAt: 1,
    };
    const keep = new Set<string>();
    referencedMediaKeys(createEmptyProject({ mediaLibrary: [asset] }), keep);
    expect(keep.has("orig.mp4")).toBe(true);
    expect(keep.has("proxy.mp4")).toBe(true);
    expect(keep.has(audioVariantKey(asset))).toBe(true);
  });
});
