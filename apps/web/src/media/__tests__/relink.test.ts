import type { ID, MediaAsset } from "@movie-desk/core";
import { describe, expect, it, vi } from "vitest";

const opfs = vi.hoisted(() => ({ writes: [] as string[], deletes: [] as string[] }));
vi.mock("@/persistence/opfs", () => ({
  writeMediaFile: async (key: string) => {
    opfs.writes.push(key);
    return key;
  },
  deleteMediaFile: async (key: string) => {
    opfs.deletes.push(key);
  },
}));

import { isMediaKeyLeased } from "@/persistence/media-gc";
import { canRelinkFromFile, compareRelinkCandidate, relinkAssetFromFile } from "../relink";

const asset = (patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id: "a" as ID,
  name: "trip.mp4",
  kind: "video",
  mime: "video/mp4",
  durationMs: 1000,
  opfsPath: "a__trip.mp4",
  sizeBytes: 1000,
  importedAt: 0,
  ...patch,
});

const file = (name: string, size: number) =>
  new File([new Uint8Array(size)], name, { type: "video/mp4" });

describe("compareRelinkCandidate", () => {
  it("accepts a file of the recorded size, whatever its name", () => {
    expect(compareRelinkCandidate(asset(), file("renamed.mp4", 1000))).toEqual({ ok: true });
  });

  it("flags a size difference with both sizes spelled out", () => {
    const verdict = compareRelinkCandidate(asset(), file("trip.mp4", 2048));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("size");
      expect(verdict.expected).toMatch(/1000|1\.0 KB|1000 B/);
      expect(verdict.actual).toMatch(/2/);
    }
  });

  it("falls back to the name when no size was recorded", () => {
    const { sizeBytes: _size, ...old } = asset();
    expect(compareRelinkCandidate(old, file("trip.mp4", 5)).ok).toBe(true);
    const verdict = compareRelinkCandidate(old, file("other.mp4", 5));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("name");
  });
});

describe("relinkAssetFromFile", () => {
  it("writes under the asset's key, drops the stale audio variant and releases its lease", async () => {
    const a = asset();
    const patch = await relinkAssetFromFile(a, file("trip.mp4", 1000));
    expect(patch).toEqual({ sizeBytes: 1000, mime: "video/mp4" });
    expect(opfs.writes).toEqual(["a__trip.mp4"]);
    expect(opfs.deletes.some((key) => key.startsWith("cache__"))).toBe(true);
    expect(isMediaKeyLeased("a__trip.mp4")).toBe(false);
  });

  it("only offers relinking for OPFS-backed assets", () => {
    expect(canRelinkFromFile(asset())).toBe(true);
    expect(
      canRelinkFromFile(
        asset({
          sourceRef: { kind: "disk", rootId: "r", relativePath: "x.mp4", sizeBytes: 1 } as never,
        }),
      ),
    ).toBe(false);
  });
});
