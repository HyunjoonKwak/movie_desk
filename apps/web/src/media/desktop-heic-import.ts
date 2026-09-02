import { isSafeRelativePath, type MediaAsset } from "@movie-desk/core";
import { z } from "zod";
import { readDesktopMediaBridge } from "./source/desktop-media-bridge";

const nonNegative = z.number().int().nonnegative();
const sourceImageMetadataSchema = z
  .object({
    orientation: z.number().int().positive().optional(),
    cameraMake: z.string().min(1).optional(),
    cameraModel: z.string().min(1).optional(),
    lensModel: z.string().min(1).optional(),
    colorSpace: z.string().min(1).optional(),
    colorProfile: z.string().min(1).optional(),
  })
  .passthrough();

const importedAssetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.literal("image"),
    mime: z.enum(["image/heic", "image/heif"]),
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
            lastKnownAbsolutePath: z.string().optional(),
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
    capturedAt: nonNegative.optional(),
    gpsLat: z.number().min(-90).max(90).optional(),
    gpsLon: z.number().min(-180).max(180).optional(),
    sourceImageMetadata: sourceImageMetadataSchema,
    thumbDataUrl: z.string().regex(/^data:image\/jpeg;base64,/),
    importedAt: nonNegative,
  })
  .passthrough();

const importResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), asset: importedAssetSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
  }),
]);

export class DesktopHeicImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DesktopHeicImportError";
    this.code = code;
  }
}

export const isHeicFile = (file: Pick<File, "name" | "type">): boolean =>
  file.type.toLowerCase() === "image/heic" ||
  file.type.toLowerCase() === "image/heif" ||
  /\.(?:heic|heif)$/i.test(file.name);

export const parseDesktopHeicImportResult = (value: unknown): MediaAsset => {
  const parsed = importResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new DesktopHeicImportError(
      "INVALID_RESPONSE",
      "The desktop image importer returned an invalid response.",
      { cause: parsed.error },
    );
  }
  if (!parsed.data.ok) {
    throw new DesktopHeicImportError(parsed.data.error.code, parsed.data.error.message);
  }
  return parsed.data.asset as unknown as MediaAsset;
};

export const importDesktopHeicFile = async (file: File): Promise<MediaAsset> => {
  const bridge = readDesktopMediaBridge();
  if (!bridge?.importHeicFile) {
    throw new DesktopHeicImportError(
      "DESKTOP_REQUIRED",
      "HEIC and HEIF originals require the Movie Desk macOS app.",
    );
  }
  return parseDesktopHeicImportResult(await bridge.importHeicFile(file));
};
