import { describe, expect, it } from "vitest";
import {
  DesktopHeicImportError,
  isHeicFile,
  parseDesktopHeicImportResult,
} from "../desktop-heic-import";

const validResult = {
  ok: true,
  asset: {
    id: "asset-1",
    name: "IMG_0001.HEIC",
    kind: "image",
    mime: "image/heic",
    durationMs: 5000,
    width: 4032,
    height: 3024,
    opfsPath: "disk-v1/asset-1",
    sourceRef: {
      kind: "disk",
      version: 1,
      rootId: "root-1",
      rootSnapshot: { volumeUuid: "AAAA-BBBB" },
      relativePath: "IMG_0001.HEIC",
      sizeBytes: 123,
      modifiedAtMs: 456,
      quickHash: `sha256:${"a".repeat(64)}`,
    },
    sizeBytes: 123,
    sourceImageMetadata: { orientation: 6, colorProfile: "Display P3" },
    thumbDataUrl: "data:image/jpeg;base64,AA==",
    importedAt: 789,
  },
} as const;

describe("desktop HEIC import boundary", () => {
  it("recognizes HEIC/HEIF by MIME or filename", () => {
    expect(isHeicFile({ name: "photo.bin", type: "image/heic" })).toBe(true);
    expect(isHeicFile({ name: "photo.HEIF", type: "" })).toBe(true);
    expect(isHeicFile({ name: "photo.jpg", type: "image/jpeg" })).toBe(false);
  });

  it("accepts a disk-referenced image without an absolute source path", () => {
    const asset = parseDesktopHeicImportResult(validResult);
    expect(asset.sourceRef?.kind).toBe("disk");
    expect(asset.sourceImageMetadata?.orientation).toBe(6);
    expect(JSON.stringify(asset)).not.toContain("/Users/");
  });

  it("rejects path traversal and preserves structured desktop failures", () => {
    expect(() =>
      parseDesktopHeicImportResult({
        ...validResult,
        asset: {
          ...validResult.asset,
          sourceRef: { ...validResult.asset.sourceRef, relativePath: "../private.heic" },
        },
      }),
    ).toThrow(DesktopHeicImportError);

    expect(() =>
      parseDesktopHeicImportResult({
        ok: false,
        error: { code: "PERMISSION_DENIED", message: "Cannot read file" },
      }),
    ).toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
  });
});
