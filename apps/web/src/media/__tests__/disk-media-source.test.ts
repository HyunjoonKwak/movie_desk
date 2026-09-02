import type { DiskSourceRef, ID, MediaAsset } from "@movie-desk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopMediaBridge } from "../source/desktop-media-bridge";
import { createDiskMediaSource } from "../source/disk-media-source";
import { MediaSourceError } from "../source/media-source";
import {
  resetMediaSourceAdaptersForTests,
  resolveMediaSource,
} from "../source/resolve-media-source";

const ref: DiskSourceRef = {
  kind: "disk",
  version: 1,
  rootId: "root-1",
  rootSnapshot: {},
  relativePath: "clips/scene.mov",
  sizeBytes: 100,
  modifiedAtMs: 1,
};

const asset = (): MediaAsset => ({
  id: "asset-1" as ID,
  name: "scene.mov",
  kind: "video",
  mime: "video/quicktime",
  durationMs: 1000,
  opfsPath: "legacy",
  importedAt: 1,
  sourceRef: ref,
});

const scriptedBridge = (
  acquireResults: unknown[] = [],
  sourceStateResult: unknown = { state: "online" },
) => {
  const acquired: string[] = [];
  const released: string[] = [];
  let leaseNumber = 0;
  const bridge: DesktopMediaBridge = {
    acquirePlaybackUrl: async (assetId) => {
      acquired.push(assetId);
      if (acquireResults.length > 0) return acquireResults.shift();
      leaseNumber += 1;
      return {
        leaseId: `lease-${leaseNumber}`,
        url: `media://asset/${assetId}?lease=lease-${leaseNumber}`,
        state: "online",
      };
    },
    releasePlaybackUrl: async (leaseId) => {
      released.push(leaseId);
      return true;
    },
    sourceState: async () => sourceStateResult,
  };
  return { bridge, acquired, released };
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetMediaSourceAdaptersForTests();
});

describe("createDiskMediaSource", () => {
  it("fetches only the clamped range and releases each read lease exactly once", async () => {
    const desktop = scriptedBridge();
    const calls: Array<{ readonly url: string; readonly range: string | null }> = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const range = new Headers(init?.headers).get("Range");
      calls.push({ url: String(input), range });
      return new Response(new Uint8Array([98, 99]), { status: 206 });
    };
    const source = await createDiskMediaSource(asset(), ref, {
      bridge: desktop.bridge,
      fetchFn,
    });

    expect(Array.from(new Uint8Array(await source.read(98, 10)))).toEqual([98, 99]);
    expect(calls).toEqual([
      {
        url: "media://asset/asset-1?lease=lease-1",
        range: "bytes=98-99",
      },
    ]);
    expect(desktop.acquired).toEqual(["asset-1"]);
    expect(desktop.released).toEqual(["lease-1"]);
  });

  it("does no bridge or fetch work for an empty range", async () => {
    const desktop = scriptedBridge();
    const fetchFn = vi.fn<typeof fetch>();
    const source = await createDiskMediaSource(asset(), ref, {
      bridge: desktop.bridge,
      fetchFn,
    });

    expect((await source.read(100, 5)).byteLength).toBe(0);
    expect((await source.read(50, 0)).byteLength).toBe(0);
    expect(desktop.acquired).toHaveLength(0);
    expect(desktop.released).toHaveLength(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("releases the read lease when fetch or response validation fails", async () => {
    const desktop = scriptedBridge();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("blocked"))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 206 }));
    const source = await createDiskMediaSource(asset(), ref, {
      bridge: desktop.bridge,
      fetchFn,
    });

    await expect(source.read(0, 2)).rejects.toMatchObject({ state: "offline" });
    await expect(source.read(0, 2)).rejects.toMatchObject({ state: "changed" });
    expect(desktop.released).toEqual(["lease-1", "lease-2"]);
  });

  it("maps protocol and bridge source states to MediaSourceError", async () => {
    const desktop = scriptedBridge([{ state: "ambiguous", reason: "multiple-matches" }]);
    const source = await createDiskMediaSource(asset(), ref, {
      bridge: desktop.bridge,
      fetchFn: vi.fn<typeof fetch>(),
    });
    await expect(source.read(0, 1)).rejects.toMatchObject({
      name: "MediaSourceError",
      state: "ambiguous",
    });

    const changed = scriptedBridge([], { state: "changed" });
    const changedSource = await createDiskMediaSource(asset(), ref, {
      bridge: changed.bridge,
      fetchFn: async () => new Response("changed", { status: 409 }),
    });
    await expect(changedSource.read(0, 1)).rejects.toMatchObject({ state: "changed" });
    expect(changed.released).toEqual(["lease-1"]);

    const denied = scriptedBridge([], { state: "permission-denied" });
    const deniedSource = await createDiskMediaSource(asset(), ref, {
      bridge: denied.bridge,
      fetchFn: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("CORS blocked")),
    });
    await expect(deniedSource.read(0, 1)).rejects.toMatchObject({
      state: "permission-denied",
    });
    expect(denied.released).toEqual(["lease-1"]);
  });

  it("validates bridge grants and rejects a missing desktop bridge", async () => {
    const invalid = scriptedBridge([{ leaseId: "lease", url: "https://example.test/file" }]);
    const invalidSource = await createDiskMediaSource(asset(), ref, {
      bridge: invalid.bridge,
      fetchFn: vi.fn<typeof fetch>(),
    });
    await expect(invalidSource.read(0, 1)).rejects.toBeInstanceOf(MediaSourceError);
    await expect(
      createDiskMediaSource(asset(), ref, { bridge: null, fetchFn: vi.fn<typeof fetch>() }),
    ).rejects.toMatchObject({ state: "offline" });
  });

  it("hands out an independent idempotent playback lease", async () => {
    const desktop = scriptedBridge();
    const source = await createDiskMediaSource(asset(), ref, { bridge: desktop.bridge });
    const playback = await source.acquirePlaybackUrl();

    expect(playback.url).toContain("media://asset/asset-1");
    playback.release();
    playback.release();
    await vi.waitFor(() => expect(desktop.released).toEqual(["lease-1"]));
  });
});

describe("disk adapter registration", () => {
  it("registers only when the complete desktop bridge is present", async () => {
    const desktop = scriptedBridge();
    vi.stubGlobal("window", { cutDesktop: { media: desktop.bridge } });
    resetMediaSourceAdaptersForTests();
    const source = await resolveMediaSource(asset());
    expect(source.assetId).toBe("asset-1");

    vi.stubGlobal("window", {});
    resetMediaSourceAdaptersForTests();
    await expect(resolveMediaSource(asset())).rejects.toMatchObject({ state: "offline" });
  });
});
