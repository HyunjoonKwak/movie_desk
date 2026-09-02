import type { ID, MediaAsset } from "@movie-desk/core";
import { describe, expect, it, vi } from "vitest";
import type { PlaybackLease, RandomAccessMediaSource } from "@/media/source/media-source";
import { acquireFrameSourceLease } from "../frame-source";

const asset = (patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id: "asset-1" as ID,
  name: "clip.mov",
  kind: "video",
  mime: "video/quicktime",
  durationMs: 1000,
  opfsPath: "legacy-original",
  importedAt: 1,
  ...patch,
});

const lease = (url: string): PlaybackLease => ({ url, release() {} });

const source = (playback: PlaybackLease): RandomAccessMediaSource => ({
  assetId: "asset-1",
  sizeBytes: 1,
  mime: "video/quicktime",
  read: async () => new ArrayBuffer(0),
  acquirePlaybackUrl: async () => playback,
});

describe("acquireFrameSourceLease", () => {
  it("prefers an available proxy without resolving the original", async () => {
    const acquireProxy = vi.fn(async () => lease("blob:proxy"));
    const resolveSource = vi.fn(async () => source(lease("media://original")));

    await expect(
      acquireFrameSourceLease(asset({ proxyPath: "proxy-1" }), true, {
        acquireProxy,
        resolveSource,
      }),
    ).resolves.toMatchObject({ url: "blob:proxy" });
    expect(acquireProxy).toHaveBeenCalledWith("proxy-1");
    expect(resolveSource).not.toHaveBeenCalled();
  });

  it("uses the common resolver for disk and legacy OPFS originals", async () => {
    const resolveSource = vi.fn(async () => source(lease("media://asset/asset-1")));

    await expect(
      acquireFrameSourceLease(asset(), false, {
        acquireProxy: vi.fn(),
        resolveSource,
      }),
    ).resolves.toMatchObject({ url: "media://asset/asset-1" });
    expect(resolveSource).toHaveBeenCalledWith(expect.objectContaining({ id: "asset-1" }));
  });

  it("falls back to the original when a configured proxy is missing", async () => {
    const resolveSource = vi.fn(async () => source(lease("media://asset/asset-1")));

    await expect(
      acquireFrameSourceLease(asset({ proxyPath: "missing" }), true, {
        acquireProxy: vi.fn(async () => null),
        resolveSource,
      }),
    ).resolves.toMatchObject({ url: "media://asset/asset-1" });
  });
});
