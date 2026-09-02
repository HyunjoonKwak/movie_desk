import type { ID, MediaAsset } from "@movie-desk/core";
import { beforeEach, describe, expect, it } from "vitest";
import { MediaSourceError, type RandomAccessMediaSource } from "../source/media-source";
import { blobMediaSource } from "../source/opfs-media-source";
import {
  registerMediaSourceAdapter,
  resetMediaSourceAdaptersForTests,
  resolveMediaSource,
} from "../source/resolve-media-source";

const bytes = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
const blob = new Blob([bytes], { type: "video/mp4" });

const asset = (patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id: "a1" as ID,
  name: "clip.mp4",
  kind: "video",
  mime: "video/mp4",
  durationMs: 1000,
  opfsPath: "key-1",
  importedAt: 1,
  ...patch,
});

describe("blobMediaSource", () => {
  it("reads exact byte ranges and clamps at the end of the file", async () => {
    const source = blobMediaSource("a1", "video/mp4", blob, async () => ({
      url: "blob:x",
      release() {},
    }));
    expect(source.sizeBytes).toBe(100);
    expect(Array.from(new Uint8Array(await source.read(10, 5)))).toEqual([10, 11, 12, 13, 14]);
    expect(Array.from(new Uint8Array(await source.read(98, 10)))).toEqual([98, 99]);
    expect((await source.read(100, 10)).byteLength).toBe(0);
  });

  it("hands out and releases a playback url lease", async () => {
    let released = 0;
    const source = blobMediaSource("a1", "video/mp4", blob, async () => ({
      url: "blob:x",
      release: () => {
        released += 1;
      },
    }));
    const lease = await source.acquirePlaybackUrl();
    expect(lease.url).toBe("blob:x");
    lease.release();
    expect(released).toBe(1);
  });
});

describe("resolveMediaSource", () => {
  beforeEach(() => resetMediaSourceAdaptersForTests());

  it("routes explicit source kinds to their registered adapter", async () => {
    const fake: RandomAccessMediaSource = {
      assetId: "a1",
      sizeBytes: 1,
      mime: "video/mp4",
      read: async () => new ArrayBuffer(0),
      acquirePlaybackUrl: async () => ({ url: "media://a1", release() {} }),
    };
    registerMediaSourceAdapter("disk", async () => fake);
    const resolved = await resolveMediaSource(
      asset({
        sourceRef: {
          kind: "disk",
          version: 1,
          rootId: "r",
          rootSnapshot: {},
          relativePath: "p",
          sizeBytes: 1,
          modifiedAtMs: 1,
        },
      }),
    );
    expect(resolved).toBe(fake);
  });

  it("reports a missing adapter as an offline source, never as a crash", async () => {
    await expect(
      resolveMediaSource(
        asset({
          sourceRef: {
            kind: "disk",
            version: 1,
            rootId: "r",
            rootSnapshot: {},
            relativePath: "p",
            sizeBytes: 1,
            modifiedAtMs: 1,
          },
        }),
      ),
    ).rejects.toMatchObject({ name: "MediaSourceError", state: "offline" });
  });

  it("falls back to the legacy OPFS adapter for assets without sourceRef", async () => {
    registerMediaSourceAdapter("opfs", async (a) =>
      blobMediaSource(a.id, a.mime, blob, async () => ({ url: "blob:y", release() {} })),
    );
    const resolved = await resolveMediaSource(asset());
    expect(resolved.sizeBytes).toBe(100);
    expect(new MediaSourceError("offline", "x")).toBeInstanceOf(Error);
  });
});
