import { describe, expect, it } from "vitest";
import { classifyMediaImportError } from "../import-errors";

describe("media import failure classification", () => {
  it.each([
    [{ code: "UNSUPPORTED_MEDIA" }, "unsupported-media", false],
    [{ code: "DECODE_FAILED" }, "damaged-file", false],
    [{ code: "PREVIEW_FAILED" }, "damaged-file", false],
    [{ name: "QuotaExceededError" }, "storage-full", true],
    [{ code: "ENOSPC" }, "storage-full", true],
    [{ code: "EACCES" }, "permission-denied", true],
    [{ name: "NotFoundError" }, "source-missing", true],
    [{ code: "DESKTOP_REQUIRED" }, "desktop-required", false],
    [new Error("unexpected"), "unknown", true],
  ] as const)("classifies %o as %s", (error, code, retryable) => {
    expect(classifyMediaImportError(error)).toEqual({ code, retryable });
  });

  it("recognises browser and filesystem storage messages without exposing them", () => {
    expect(classifyMediaImportError(new Error("ENOSPC: no space left on device"))).toEqual({
      code: "storage-full",
      retryable: true,
    });
  });
});
