import type { ID, MediaAsset } from "@movie-desk/core";
import { describe, expect, it, vi } from "vitest";

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
  const deps = () => {
    const calls = { replaced: [] as string[], removed: [] as string[] };
    return {
      calls,
      deps: {
        replace: async (key: string) => {
          calls.replaced.push(key);
          return key;
        },
        remove: async (key: string) => {
          calls.removed.push(key);
        },
        probe: async () => ({
          kind: "video" as const,
          mime: "video/mp4",
          durationMs: 4200,
          width: 640,
          height: 360,
        }),
        containerInfo: async () => ({
          container: "mp4" as const,
          videoCodec: "avc1",
          audioCodec: null,
          rotation: 90 as const,
          width: 640,
          height: 360,
        }),
        imageThumb: async () => "data:image/png;base64,thumb",
        videoThumb: async () => "data:image/png;base64,vthumb",
        filmstrip: async () => ({ dataUrl: "data:image/png;base64,strip", frames: 10 }),
        waveform: async () => [0.5, 0.25],
      },
    };
  };

  it("replaces the bytes under the asset's key, drops the stale audio variant, keeps the proxy for an identical file", async () => {
    const a = asset({ proxyPath: "a__proxy.mp4" });
    const { calls, deps: d } = deps();
    const patch = await relinkAssetFromFile(a, file("trip.mp4", 1000), { identical: true }, d);
    expect(patch).toEqual({ sizeBytes: 1000, mime: "video/mp4", dropProxy: false });
    expect(calls.replaced).toEqual(["a__trip.mp4"]);
    expect(calls.removed.some((key) => key.startsWith("cache__"))).toBe(true);
    expect(calls.removed).not.toContain("a__proxy.mp4");
    expect(isMediaKeyLeased("a__trip.mp4")).toBe(false);
  });

  it("drops the proxy and re-reads the facts for a file that is not the imported one", async () => {
    const a = asset({ proxyPath: "a__proxy.mp4" });
    const { calls, deps: d } = deps();
    const patch = await relinkAssetFromFile(a, file("other.mp4", 2048), { identical: false }, d);
    expect(patch).toEqual({
      sizeBytes: 2048,
      mime: "video/mp4",
      dropProxy: true,
      durationMs: 4200,
      width: 640,
      height: 360,
      rotation: 90,
      videoCodec: "avc1",
      audioCodec: null,
      thumbDataUrl: "data:image/png;base64,vthumb",
      filmstripDataUrl: "data:image/png;base64,strip",
      filmstripFrames: 10,
      waveformPeaks: [0.5, 0.25],
    });
    expect(calls.removed).toContain("a__proxy.mp4");
  });

  it("releases the GC lease when the write fails", async () => {
    const a = asset();
    const { deps: d } = deps();
    await expect(
      relinkAssetFromFile(
        a,
        file("trip.mp4", 1000),
        { identical: true },
        {
          ...d,
          replace: async () => {
            throw new Error("quota");
          },
        },
      ),
    ).rejects.toThrow("quota");
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
