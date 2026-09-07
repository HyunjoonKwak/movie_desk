import { describe, expect, it, vi } from "vitest";
import { BoundedResourceCache } from "../bounded-resource-cache";
import type { GL } from "../gl";
import { ScratchPool } from "../scratch-pool";

vi.mock("../gl", () => ({ allocateTarget: vi.fn(() => ({ tex: {}, fbo: {} })) }));

describe("render resource leases", () => {
  it("keeps a suspended parent resident and refuses an over-budget child atomically", async () => {
    const dispose = vi.fn();
    const cache = new BoundedResourceCache<string, number>(3, dispose, 100, (n) => n);
    cache.set("parent", 70);
    cache.set("idle", 20);
    const release = cache.pin("parent")!;
    await Promise.resolve();
    expect(cache.tryReserve(40)).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    expect(cache.weight).toBe(90);
    expect(cache.tryReserve(30)).toBe(true);
    cache.set("child", 30);
    expect(cache.get("parent")).toBe(70);
    expect(cache.weight).toBe(100);
    release();
    expect(cache.tryReserve(80)).toBe(true);
    expect(cache.weight).toBe(0);
  });

  it("defers retain/clear destruction until every borrower releases exactly once", () => {
    const dispose = vi.fn();
    const cache = new BoundedResourceCache<string, number>(2, dispose, 100, (n) => n);
    cache.set("shared-image", 64);
    const parent = cache.pin("shared-image")!;
    const child = cache.pin("shared-image")!;
    cache.retain(new Set());
    cache.clear();
    expect(cache.weight).toBe(64);
    expect(cache.get("shared-image")).toBeUndefined();
    parent();
    parent();
    expect(dispose).not.toHaveBeenCalled();
    child();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache.weight).toBe(0);
  });

  it("counts pinned entries as well as bytes and refuses in-place replacement", () => {
    const cache = new BoundedResourceCache<string, object>(1, vi.fn());
    const value = {};
    cache.set("raw", value);
    const release = cache.pin("raw")!;
    expect(cache.tryReserve(0)).toBe(false);
    expect(() => cache.set("raw", {})).toThrow("leased");
    expect(cache.get("raw")).toBe(value);
    release();
    expect(cache.tryReserve(0)).toBe(true);
  });

  it("isolates depth, role, size and overlapping output leases without deleting a parent", () => {
    const gl = { deleteTexture: vi.fn(), deleteFramebuffer: vi.fn() } as unknown as GL;
    const pool = new ScratchPool(gl);
    const parent = pool.lease(0, 0, 1920, 1080);
    const child = pool.lease(1, 0, 320, 180);
    const role = pool.lease(0, 1, 1920, 1080);
    const overlap = pool.lease(0, 0, 640, 360);
    expect(new Set([parent.tex, child.tex, role.tex, overlap.tex]).size).toBe(4);
    expect(gl.deleteTexture).not.toHaveBeenCalled();
    child.release();
    const reused = pool.lease(1, 0, 320, 180);
    expect(reused.tex).toBe(child.tex);
    pool.dispose();
    expect(gl.deleteTexture).not.toHaveBeenCalled();
    for (const lease of [parent, reused, role, overlap]) {
      lease.release();
      lease.release();
    }
    expect(gl.deleteTexture).toHaveBeenCalledTimes(4);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(4);
  });
});
