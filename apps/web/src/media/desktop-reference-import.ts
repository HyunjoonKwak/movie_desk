import { isSafeRelativePath, type MediaAsset } from "@movie-desk/core";
import { z } from "zod";
import { readDesktopMediaBridge } from "./source/desktop-media-bridge";

// Import a file by reference: the catalog learns where it is, the bytes stay
// where the user put them. Only the desktop app can do this; the browser has no
// stable way to re-open a file it was handed once.
// See docs/decisions/2026-09-08-library-model.md.

const nonNegative = z.number().int().nonnegative();

const importedAssetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["video", "image", "audio"]),
    mime: z.string().min(1),
    durationMs: nonNegative,
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    opfsPath: z.string().min(1),
    sourceRef: z
      .object({
        kind: z.literal("disk"),
        version: z.literal(1),
        rootId: z.string().min(1),
        rootSnapshot: z
          .object({
            volumeUuid: z.string().optional(),
            volumeRelativePath: z.string().optional(),
            // Main keeps the absolute path as a recovery hint and must not send
            // it here; reject the response rather than store it.
            lastKnownAbsolutePath: z.undefined(),
          })
          .passthrough(),
        relativePath: z.string().min(1).refine(isSafeRelativePath),
        sizeBytes: nonNegative,
        modifiedAtMs: nonNegative,
        inode: z.string().optional(),
        quickHash: z.string().optional(),
        fullHash: z.string().optional(),
      })
      .passthrough(),
    sizeBytes: nonNegative,
    // Required by the project schema on save. Refusing it here turns a silent
    // save failure into an import error the user can see.
    importedAt: nonNegative,
    capturedAt: nonNegative.optional(),
  })
  .passthrough();

const importResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), asset: importedAssetSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
  }),
]);

export class DesktopReferenceImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DesktopReferenceImportError";
    this.code = code;
  }
}

/** True when this build can reference originals instead of copying them. */
export const canReferenceInPlace = (): boolean =>
  Boolean(readDesktopMediaBridge()?.importFile);

export const parseDesktopReferenceImportResult = (value: unknown): MediaAsset => {
  const parsed = importResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new DesktopReferenceImportError(
      "INVALID_RESPONSE",
      "The desktop importer returned an invalid response.",
      { cause: parsed.error },
    );
  }
  if (!parsed.data.ok) {
    throw new DesktopReferenceImportError(parsed.data.error.code, parsed.data.error.message);
  }
  return parsed.data.asset as unknown as MediaAsset;
};

export const importDesktopReferenceFile = async (file: File): Promise<MediaAsset> => {
  const bridge = readDesktopMediaBridge();
  if (!bridge?.importFile) {
    throw new DesktopReferenceImportError(
      "DESKTOP_REQUIRED",
      "Referencing originals in place requires the Movie Desk macOS app.",
    );
  }
  return parseDesktopReferenceImportResult(await bridge.importFile(file));
};
