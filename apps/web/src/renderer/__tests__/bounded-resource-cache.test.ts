import { describe, expect, it, vi } from "vitest";
import { BoundedResourceCache } from "../bounded-resource-cache";

describe("BoundedResourceCache", () => {
  it("evicts the least recently used entry at its hard limit", () => {
    const dispose = vi.fn();
    const cache = new BoundedResourceCache<string, object>(2, dispose);
    const a = {};
    const b = {};
    const c = {};
    cache.set("a", a);
    cache.set("b", b);
    expect(cache.get("a")).toBe(a);

    cache.set("c", c);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(a);
    expect(cache.get("c")).toBe(c);
    expect(dispose).toHaveBeenCalledWith(b, "b");
  });

  it("disposes replaced, removed, and cleared resources exactly once", () => {
    const disposed: string[] = [];
    const cache = new BoundedResourceCache<string, string>(3, (value) => disposed.push(value));
    cache.set("a", "old-a");
    cache.set("a", "new-a");
    cache.set("b", "b");
    cache.retain(new Set(["a"]));
    cache.clear();

    expect(disposed).toEqual(["old-a", "b", "new-a"]);
    expect(cache.size).toBe(0);
  });

  it("reserves bytes before allocation and preserves weighted LRU order", () => {
    const dispose = vi.fn();
    const cache = new BoundedResourceCache<string, number>(12, dispose, 128, (n) => n);
    cache.set("a", 60);
    cache.set("b", 60);
    cache.get("a");
    cache.reserve(64);
    expect(dispose).toHaveBeenCalledWith(60, "b");
    expect(cache.weight).toBe(60);
    cache.set("c", 64);
    expect(cache.weight).toBe(124);
    cache.set("a", 32);
    expect(cache.weight).toBe(96);
    cache.retain(new Set(["a"]));
    expect(cache.weight).toBe(32);
    cache.clear();
    expect(cache.weight).toBe(0);
  });

  it("rejects oversized resources without disposing the live cache", () => {
    const cache = new BoundedResourceCache<string, number>(12, vi.fn(), 128, (n) => n);
    cache.set("a", 64);
    expect(() => cache.reserve(129)).toThrow("budget");
    expect(() => cache.set("b", 129)).toThrow("budget");
    expect(cache.get("a")).toBe(64);
    expect(cache.weight).toBe(64);
  });

  it("rejects invalid limits", () => {
    expect(() => new BoundedResourceCache(0, () => {})).toThrow("positive integer");
  });
});
