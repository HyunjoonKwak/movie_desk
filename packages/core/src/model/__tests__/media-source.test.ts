import { describe, expect, it } from "vitest";
import type { DiskSourceRef, OpfsSourceRef } from "../media-source";
import {
  cacheKey,
  isSafeRelativePath,
  legacySourceRef,
  sourceFingerprint,
  sourceRefOf,
} from "../media-source";

// D1 contract: identity of a *location + content* is a fingerprint; the
// asset id stays a free UUID. These helpers are the only place the string
// formats live, so the cache and the catalog agree by construction.
const disk: DiskSourceRef = {
  kind: "disk",
  version: 1,
  rootId: "root-1",
  rootSnapshot: { volumeUuid: "VOL-UUID", volumeRelativePath: "Movies/Library" },
  relativePath: "2025/08/IMG_0001.MOV",
  sizeBytes: 123_456_789,
  modifiedAtMs: 1_755_000_000_000,
};

describe("sourceFingerprint", () => {
  it("combines root, relative path, size and mtime for disk sources", () => {
    expect(sourceFingerprint(disk)).toBe(
      "disk,root-1,2025%2F08%2FIMG_0001.MOV,123456789,1755000000000",
    );
  });

  it("appends the quick hash when one is known", () => {
    expect(sourceFingerprint({ ...disk, quickHash: "abc" })).toBe(
      "disk,root-1,2025%2F08%2FIMG_0001.MOV,123456789,1755000000000,abc",
    );
  });

  it("changes when the file changes but not when the asset id would", () => {
    expect(sourceFingerprint({ ...disk, modifiedAtMs: disk.modifiedAtMs + 1 })).not.toBe(
      sourceFingerprint(disk),
    );
  });

  it("keys legacy OPFS copies by their store key", () => {
    const opfs: OpfsSourceRef = { kind: "opfs", version: 1, key: "abc__clip.mp4", sizeBytes: 10 };
    expect(sourceFingerprint(opfs)).toBe("opfs,abc__clip.mp4,10");
    expect(sourceFingerprint({ kind: "opfs", version: 1, key: "abc__clip.mp4" })).toBe(
      "opfs,abc__clip.mp4",
    );
  });

  it("keeps component boundaries when values contain the delimiter or slashes", () => {
    const a = sourceFingerprint({ ...disk, rootId: "a,b", relativePath: "c" });
    const b = sourceFingerprint({ ...disk, rootId: "a", relativePath: "b,c" });
    expect(a).not.toBe(b);
    expect(sourceFingerprint({ ...disk, relativePath: "x/y:z" })).not.toContain("/");
    expect(sourceFingerprint({ ...disk, relativePath: "x/y:z" })).not.toContain(":");
  });
});

describe("cacheKey", () => {
  it("includes fingerprint, variant and pipeline version", () => {
    expect(cacheKey("disk,r,p,1,2", "thumb-240", 3)).toBe("thumb-240/v3/disk%2Cr%2Cp%2C1%2C2");
  });

  it("never produces extra path segments from its inputs", () => {
    const key = cacheKey(
      sourceFingerprint({ ...disk, relativePath: "a/b/c.mov" }),
      "analysis-clip/v2",
      1,
    );
    expect(key.split("/")).toHaveLength(3);
  });

  it("rejects a pipeline version that is not a non-negative integer", () => {
    expect(() => cacheKey("f", "thumb-240", -1)).toThrow(RangeError);
    expect(() => cacheKey("f", "thumb-240", 1.5)).toThrow(RangeError);
  });
});

describe("isSafeRelativePath", () => {
  it("accepts nested relative paths", () => {
    expect(isSafeRelativePath("2025/08/IMG_0001.MOV")).toBe(true);
    expect(isSafeRelativePath("clip.mov")).toBe(true);
    expect(isSafeRelativePath("a..b/..c")).toBe(true); // dots inside a name are not traversal
  });

  it("rejects absolute paths, NUL bytes and parent traversal", () => {
    expect(isSafeRelativePath("/Users/me/clip.mov")).toBe(false);
    expect(isSafeRelativePath("\\server\\share")).toBe(false);
    expect(isSafeRelativePath("C:\\clips\\a.mov")).toBe(false);
    expect(isSafeRelativePath("a/../b.mov")).toBe(false);
    expect(isSafeRelativePath("../b.mov")).toBe(false);
    expect(isSafeRelativePath("a\\..\\b.mov")).toBe(false);
    expect(isSafeRelativePath("a\0b.mov")).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
  });
});

describe("sourceRefOf", () => {
  it("falls back to the legacy OPFS reference for assets imported before D1", () => {
    const ref = sourceRefOf({ opfsPath: "abc__clip.mp4", sizeBytes: 42 });
    expect(ref).toEqual({ kind: "opfs", version: 1, key: "abc__clip.mp4", sizeBytes: 42 });
    expect(legacySourceRef({ opfsPath: "k" })).toEqual({ kind: "opfs", version: 1, key: "k" });
  });

  it("prefers an explicit sourceRef", () => {
    expect(sourceRefOf({ opfsPath: "legacy", sourceRef: disk })).toBe(disk);
  });
});
