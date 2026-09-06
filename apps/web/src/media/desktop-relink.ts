import { deleteMediaFile } from "@/persistence/opfs";
import { putAssetPreviews } from "@/persistence/previews";
import type { RelinkAssetPatch } from "@/stores/actions/media-actions";
import { type DiskSourceRef, type MediaAsset, isSafeRelativePath } from "@movie-desk/core";
import { z } from "zod";
import { audioVariantKey } from "./audio/audio-variant";
import { buildRelinkPreviews } from "./relink";
import { readDesktopMediaBridge } from "./source/desktop-media-bridge";
import { resolveMediaSource } from "./source/resolve-media-source";

const candidateSchema = z.object({
  assetId: z.string(),
  token: z.string().optional(),
  name: z.string().optional(),
  reason: z.enum(["kind", "unsupported", "decode", "outside", "unavailable"]).optional(),
  relativePath: z.string().refine(isSafeRelativePath),
  verdict: z.enum(["identical", "size", "fingerprint", "unavailable"]),
  sizeBytes: z.number().nonnegative().optional(),
  expectedSizeBytes: z.number().nonnegative().optional(),
});
export type DesktopRelinkCandidate = z.infer<typeof candidateSchema>;

export const chooseDesktopRelink = async (ids: readonly string[], folder = false) => {
  const bridge = readDesktopMediaBridge();
  if (!bridge?.chooseRelink) throw new Error("Desktop relinking is unavailable");
  const result = await bridge.chooseRelink(ids, folder);
  if (typeof result === "object" && result !== null && "tooMany" in result) throw new Error("tooMany");
  if (typeof result === "object" && result !== null && "error" in result) throw new Error(String(result.error));
  return z.array(candidateSchema).parse(result);
};

// The preview only enables exact-path rows which were inspected successfully.
// Multiple assets can share a basename; it is never an identity match.
export const matchDesktopRelinkRows = (
  assets: readonly MediaAsset[],
  rows: readonly DesktopRelinkCandidate[],
) =>
  rows.filter((row) =>
    assets.some(
      (asset) =>
        asset.id === row.assetId &&
        asset.sourceRef?.kind === "disk" &&
        asset.sourceRef.relativePath === row.relativePath,
    ),
  );

const resultSchema = z.object({
  assetId: z.string(),
  identical: z.boolean(),
  mime: z.string(),
  width: z.number().positive().nullish().catch(null),
  height: z.number().positive().nullish().catch(null),
  durationMs: z.number().nonnegative().nullish().catch(null),
  sourceRef: z.object({
    kind: z.literal("disk"),
    version: z.literal(1),
    rootId: z.string(),
    rootSnapshot: z.object({
      volumeUuid: z.string().optional(),
      volumeRelativePath: z.string().optional(),
    }),
    relativePath: z.string().refine(isSafeRelativePath),
    sizeBytes: z.number().int().nonnegative(),
    modifiedAtMs: z.number().int().nonnegative(),
    inode: z.string().optional(),
    quickHash: z.string().optional(),
    fullHash: z.string().optional(),
  }),
});

export const commitDesktopRelink = async (
  candidate: DesktopRelinkCandidate,
  confirmed: boolean,
  asset?: MediaAsset,
): Promise<RelinkAssetPatch> => {
  const bridge = readDesktopMediaBridge();
  if (!bridge?.commitRelink || !candidate.token) throw new Error("Choose a file again");
  const result = resultSchema.parse(await bridge.commitRelink(candidate.token, confirmed));
  if (result.assetId !== candidate.assetId) throw new Error("Unexpected relink result");
  if (asset && !result.identical) {
    // Only discard app-owned derived files; originals remain main-process references.
    if (asset.kind !== "image") await deleteMediaFile(audioVariantKey(asset)).catch(() => {});
    if (asset.proxyPath) await deleteMediaFile(asset.proxyPath).catch(() => {});
    const updated = { ...asset, sourceRef: result.sourceRef as DiskSourceRef, mime: result.mime };
    try {
      const source = await resolveMediaSource(updated);
      const lease = await source.acquirePlaybackUrl();
      try {
        const response = await fetch(lease.url);
        if (!response.ok) throw new Error("Source unavailable");
        const blob = await response.blob();
        const file = new File([blob], candidate.name ?? asset.name, {
          type: blob.type || result.mime,
        });
        const patch = await buildRelinkPreviews(updated, file);
        return {
          width: null,
          height: null,
          rotation: 0,
          sourceImageMetadata: null,
          durationMs: asset.kind === "image" ? asset.durationMs : 0,
          ...patch,
          // HEIC playback uses a JPEG editing preview, whose dimensions can
          // differ from the original. Preserve the helper's original facts.
          ...(asset.kind === "image"
            ? {
                width: result.width ?? patch.width ?? null,
                height: result.height ?? patch.height ?? null,
              }
            : {}),
          sourceRef: updated.sourceRef,
          sizeBytes: result.sourceRef.sizeBytes,
          mime: result.mime,
        };
      } finally {
        lease.release();
      }
    } catch {
      // Connection is already committed. Clear stale facts if rebuilding fails.
    }
  }
  let previewsStored = true;
  if (!result.identical) {
    try {
      await putAssetPreviews(result.assetId, {});
    } catch {
      previewsStored = false;
    }
  }
  return {
    sourceRef: result.sourceRef as DiskSourceRef,
    sizeBytes: result.sourceRef.sizeBytes,
    mime: result.mime,
    dropProxy: !result.identical,
    previewsStored,
    ...(!result.identical
      ? {
          width: result.width ?? null,
          height: result.height ?? null,
          durationMs: result.durationMs ?? (asset?.kind === "image" ? asset.durationMs : 0),
          sourceImageMetadata: null,
          rotation: 0,
          videoCodec: null,
          audioCodec: null,
          hasAudio: null,
          thumbDataUrl: null,
          filmstripDataUrl: null,
          filmstripFrames: null,
          waveformPeaks: null,
        }
      : {}),
  };
};

export const defaultDesktopRelinkSelection = (rows: readonly DesktopRelinkCandidate[]) =>
  new Set(rows.filter((row) => row.token && row.verdict === "identical").map((row) => row.assetId));

export const selectedDesktopRelinkRows = (rows: readonly DesktopRelinkCandidate[], selected: ReadonlySet<string>, done: ReadonlySet<string>) =>
  rows.filter((row) => row.token && selected.has(row.assetId) && !done.has(row.assetId));
