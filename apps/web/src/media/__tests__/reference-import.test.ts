import { newId, type MediaAsset } from "@movie-desk/core";
import { expect, it, vi } from "vitest";
import { parseDesktopReferenceImportResult } from "../desktop-reference-import";
import { runMediaImportBatch } from "../import-batch";

const candidate = (name: string) => ({
  file: new File([new Uint8Array(8)], name, { type: "video/mp4" }),
  relativePath: name,
});

const asset = (id: string): MediaAsset =>
  ({ id, name: "clip.mp4", kind: "video", mime: "video/mp4", durationMs: 1000 }) as MediaAsset;

const deps = (over: Partial<Parameters<typeof runMediaImportBatch>[1]> = {}) => ({
  importFile: vi.fn(async () => ({ asset: asset(newId()), releaseLease: () => {} })),
  importHeicFile: vi.fn(async () => asset(newId())),
  isHeicFile: () => false,
  hasAsset: () => false,
  addMediaAsset: vi.fn(),
  isCancelRequested: () => false,
  onFileStart: () => {},
  onFileDone: () => {},
  onFileFailed: () => {},
  ...over,
});

it("references the original on desktop instead of copying it", async () => {
  const importByReference = vi.fn(async () => asset(newId()));
  const d = deps({ importByReference, canReferenceInPlace: () => true });
  await runMediaImportBatch([candidate("clip.mp4")], d);
  expect(importByReference).toHaveBeenCalledOnce();
  // The copying path must not run at all, or the file would be duplicated.
  expect(d.importFile).not.toHaveBeenCalled();
});

it("falls back to copying when this build cannot reference in place", async () => {
  const importByReference = vi.fn(async () => asset(newId()));
  const d = deps({ importByReference, canReferenceInPlace: () => false });
  await runMediaImportBatch([candidate("clip.mp4")], d);
  expect(importByReference).not.toHaveBeenCalled();
  expect(d.importFile).toHaveBeenCalledOnce();
});

it("copies when no reference importer is wired at all", async () => {
  const d = deps();
  await runMediaImportBatch([candidate("clip.mp4")], d);
  expect(d.importFile).toHaveBeenCalledOnce();
});

it("keeps a failed reference from aborting the rest of the batch", async () => {
  const importByReference = vi
    .fn()
    .mockRejectedValueOnce(new Error("unreadable"))
    .mockResolvedValueOnce(asset(newId()));
  const failed = vi.fn();
  const result = await runMediaImportBatch(
    [candidate("a.mp4"), candidate("b.mp4")],
    deps({ importByReference, canReferenceInPlace: () => true, onFileFailed: failed }),
  );
  expect(failed).toHaveBeenCalledOnce();
  expect(result.done).toBe(1);
  expect(result.failed).toBe(1);
});

it("refuses a response that leaks the absolute path", () => {
  const leaky = {
    ok: true,
    asset: {
      id: "a",
      name: "clip.mp4",
      kind: "video",
      mime: "video/mp4",
      durationMs: 1000,
      opfsPath: "disk-v1/a",
      sizeBytes: 10,
      sourceRef: {
        kind: "disk",
        version: 1,
        rootId: "r",
        rootSnapshot: { volumeUuid: "V", lastKnownAbsolutePath: "/Users/someone/Movies" },
        relativePath: "clip.mp4",
        sizeBytes: 10,
        modifiedAtMs: 1,
      },
    },
  };
  expect(() => parseDesktopReferenceImportResult(leaky)).toThrow();
});

it("reports the desktop error rather than a generic failure", () => {
  expect(() =>
    parseDesktopReferenceImportResult({
      ok: false,
      error: { code: "PERMISSION_DENIED", message: "no permission" },
    }),
  ).toThrow(/no permission/);
});
