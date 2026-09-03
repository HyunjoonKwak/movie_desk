import type { ID, MediaAsset } from "@movie-desk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaSourceError, type RandomAccessMediaSource } from "../source/media-source";
import { probeAssetSource } from "../source/probe-source";
import { configureSourceHealthForTests, useSourceHealthStore } from "../source-health-store";

const asset = (id: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id: id as ID,
  name: `${id}.mp4`,
  kind: "video",
  mime: "video/mp4",
  durationMs: 1000,
  opfsPath: `${id}__${id}.mp4`,
  sizeBytes: 1,
  importedAt: 0,
  ...extra,
});

const source = (sizeBytes = 1, read = async () => new ArrayBuffer(1)) =>
  ({
    assetId: "x",
    sizeBytes,
    mime: "video/mp4",
    read,
    acquirePlaybackUrl: vi.fn(),
  }) as unknown as RandomAccessMediaSource;

afterEach(() => {
  configureSourceHealthForTests({});
  useSourceHealthStore.setState({ entries: {} });
});

describe("probeAssetSource", () => {
  it("is ok only when the source opens and its first byte reads", async () => {
    expect(await probeAssetSource(asset("a"), async () => source())).toBe("ok");
    expect(await probeAssetSource(asset("a"), async () => source(0))).toBe("changed");
    expect(
      await probeAssetSource(asset("a"), async () => {
        throw new MediaSourceError("offline", "gone");
      }),
    ).toBe("offline");
    expect(
      await probeAssetSource(asset("a"), async () =>
        source(1, async () => {
          throw new MediaSourceError("permission-denied", "403");
        }),
      ),
    ).toBe("permission-denied");
    expect(
      await probeAssetSource(asset("a"), async () => {
        throw new Error("boom");
      }),
    ).toBe("unknown");
  });
});

describe("source health store", () => {
  it("probes each asset once until it changes or its check goes stale", async () => {
    const probed: string[] = [];
    let now = 1_000;
    configureSourceHealthForTests({
      probe: async (a) => {
        probed.push(a.id);
        return a.id === "b" ? "offline" : "ok";
      },
      now: () => now,
    });
    const a = asset("a");
    const b = asset("b");
    await useSourceHealthStore.getState().check([a, b]);
    expect(probed).toEqual(["a", "b"]);
    expect(useSourceHealthStore.getState().entries.b?.health).toBe("offline");

    // Same records, fresh check: nothing to do.
    await useSourceHealthStore.getState().check([a, b]);
    expect(probed).toEqual(["a", "b"]);

    // A relinked record (new object) is probed again; the other is left alone.
    const relinked = asset("b", { proxyPath: "p" });
    await useSourceHealthStore.getState().check([a, relinked]);
    expect(probed).toEqual(["a", "b", "b"]);

    // Stale checks are redone when asked with a shorter max age.
    now += 10_000;
    await useSourceHealthStore.getState().check([a, relinked], { maxAgeMs: 5_000 });
    expect(probed).toEqual(["a", "b", "b", "a", "b"]);
  });

  it("limits how many probes run at once", async () => {
    let inFlight = 0;
    let peak = 0;
    configureSourceHealthForTests({
      probe: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return "ok";
      },
    });
    await useSourceHealthStore
      .getState()
      .check(Array.from({ length: 10 }, (_, i) => asset(`a${i}`)));
    expect(peak).toBeLessThanOrEqual(4);
    expect(Object.keys(useSourceHealthStore.getState().entries)).toHaveLength(10);
  });
});
