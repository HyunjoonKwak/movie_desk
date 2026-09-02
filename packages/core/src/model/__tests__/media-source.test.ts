import { describe, expect, it } from "vitest";
import type { DiskSourceRef, OpfsSourceRef } from "../media-source";
import { cacheKey, legacySourceRef, sourceFingerprint, sourceRefOf } from "../media-source";

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
      "disk:root-1:2025/08/IMG_0001.MOV:123456789:1755000000000",
    );
  });

  it("appends the quick hash when one is known", () => {
    expect(sourceFingerprint({ ...disk, quickHash: "abc" })).toBe(
      "disk:root-1:2025/08/IMG_0001.MOV:123456789:1755000000000:abc",
    );
  });

  it("changes when the file changes but not when the asset id would", () => {
    expect(sourceFingerprint({ ...disk, modifiedAtMs: disk.modifiedAtMs + 1 })).not.toBe(
      sourceFingerprint(disk),
    );
  });

  it("keys legacy OPFS copies by their store key", () => {
    const opfs: OpfsSourceRef = { kind: "opfs", version: 1, key: "abc__clip.mp4", sizeBytes: 10 };
    expect(sourceFingerprint(opfs)).toBe("opfs:abc__clip.mp4:10");
    expect(sourceFingerprint({ kind: "opfs", version: 1, key: "abc__clip.mp4" })).toBe(
      "opfs:abc__clip.mp4",
    );
  });
});

describe("cacheKey", () => {
  it("includes fingerprint, variant and pipeline version", () => {
    expect(cacheKey("disk:r:p:1:2", "thumb-240", 3)).toBe("thumb-240/v3/disk:r:p:1:2");
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
