import type { ID, MediaAsset } from "@movie-desk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The element-fallback pool backs off on a source that cannot be opened:
// the first miss retries after a second, later misses wait longer, and a
// changed asset record is tried again at once.

const resolveSource = vi.fn<() => Promise<never>>();

vi.mock("@/media/source/resolve-media-source", () => ({
  resolveMediaSource: () => resolveSource(),
}));
vi.mock("@/media/proxy-store", () => ({
  useProxyStore: { getState: () => ({ useProxy: false }) },
}));
vi.mock("@/persistence/opfs", () => ({ acquireMediaUrl: async () => null }));

import { FrameSourcePool } from "../frame-source";

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["performance"] });
  resolveSource.mockReset();
  resolveSource.mockRejectedValue(new Error("offline"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FrameSourcePool backoff", () => {
  it("retries a missing source after a second, then waits longer", async () => {
    const pool = new FrameSourcePool();
    const a = asset();
    expect(await pool.get(a)).toBeNull();
    expect(resolveSource).toHaveBeenCalledTimes(1);

    // Inside the first delay: no probe.
    expect(await pool.get(a)).toBeNull();
    expect(resolveSource).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_100);
    expect(await pool.get(a)).toBeNull();
    expect(resolveSource).toHaveBeenCalledTimes(2);

    // The second delay is two seconds.
    vi.advanceTimersByTime(1_100);
    expect(await pool.get(a)).toBeNull();
    expect(resolveSource).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1_000);
    expect(await pool.get(a)).toBeNull();
    expect(resolveSource).toHaveBeenCalledTimes(3);
  });

  it("tries a changed asset record immediately", async () => {
    const pool = new FrameSourcePool();
    const a = asset();
    expect(await pool.get(a)).toBeNull();
    expect(resolveSource).toHaveBeenCalledTimes(1);
    expect(await pool.get({ ...a, proxyPath: "proxy.mp4" })).toBeNull();
    expect(resolveSource).toHaveBeenCalledTimes(2);
  });
});
