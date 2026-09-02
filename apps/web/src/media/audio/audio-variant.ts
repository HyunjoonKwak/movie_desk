import { readMediaFile, writeMediaFile } from "@/persistence/opfs";
import { toByteSource } from "@/renderer/mp4-decoder";
import type { MediaKind, SourceRef } from "@movie-desk/core";
import { cacheKey, sourceFingerprint, sourceRefOf } from "@movie-desk/core";
import { resolveMediaSource } from "../source/resolve-media-source";
import { remuxAudioTrack } from "./audio-track-remux";

// The "audio-track" cache variant (D1 cache rules): the source's audio track
// alone, rebuildable from the original, keyed by fingerprint + variant +
// pipeline version. Bump the version when the remux pipeline changes.
const AUDIO_VARIANT = "audio-track" as const;
const AUDIO_PIPELINE_VERSION = 1;

// Enough of MediaAsset to locate the bytes; import can call this before the
// asset record exists.
export interface AudioVariantAsset {
  readonly id?: string;
  readonly opfsPath: string;
  readonly sizeBytes?: number;
  readonly mime?: string;
  readonly kind?: MediaKind;
  readonly sourceRef?: SourceRef;
}

// OPFS forbids "/" in names; the cache key's three segments become "__".
export const audioVariantKey = (asset: AudioVariantAsset): string =>
  `cache__${cacheKey(sourceFingerprint(sourceRefOf(asset)), AUDIO_VARIANT, AUDIO_PIPELINE_VERSION).replaceAll("/", "__")}`;

interface Deps {
  readonly onBuild?: () => void;
  readonly writeVariant?: (key: string, file: File) => Promise<unknown>;
}

const pendingBuilds = new Map<string, Promise<Blob | null>>();

const originalBlob = async (asset: AudioVariantAsset): Promise<Blob | null> => {
  if (asset.sourceRef && asset.sourceRef.kind !== "opfs") {
    // A referenced file with no extractable track: read it through its
    // adapter. Bounded to what the fallback decoder needs anyway.
    const source = await resolveMediaSource({
      ...asset,
      id: asset.id ?? "",
      name: "",
      kind: asset.kind ?? "video",
      mime: asset.mime ?? "application/octet-stream",
      durationMs: 0,
      importedAt: 0,
    } as Parameters<typeof resolveMediaSource>[0]);
    const chunks: ArrayBuffer[] = [];
    const step = 4 * 1024 * 1024;
    for (let offset = 0; offset < source.sizeBytes; offset += step) {
      chunks.push(await source.read(offset, step));
    }
    return new Blob(chunks, asset.mime ? { type: asset.mime } : undefined);
  }
  return readMediaFile(asset.opfsPath);
};

// Returns the cached audio-only file, building it on first use. Null when
// the source has no AAC track (silent video, WebM, unsupported codec) or is
// unreachable; callers then fall back to the original.
const buildAudioVariant = async (
  asset: AudioVariantAsset,
  key: string,
  deps: Deps = {},
): Promise<Blob | null> => {
  let input: Blob | Awaited<ReturnType<typeof resolveMediaSource>> | null;
  try {
    input =
      asset.sourceRef && asset.sourceRef.kind !== "opfs"
        ? await resolveMediaSource({
            ...asset,
            id: asset.id ?? "",
            name: "",
            kind: asset.kind ?? "video",
            mime: asset.mime ?? "application/octet-stream",
            durationMs: 0,
            importedAt: 0,
          } as Parameters<typeof resolveMediaSource>[0])
        : await readMediaFile(asset.opfsPath);
  } catch {
    return null;
  }
  if (!input) return null;

  deps.onBuild?.();
  const byteSource = toByteSource(input);
  const remuxed = await remuxAudioTrack(byteSource).catch(() => null);
  if (!remuxed) return null;
  try {
    await (deps.writeVariant ?? writeMediaFile)(
      key,
      new File([remuxed.blob], key, { type: "audio/mp4" }),
    );
  } catch {
    // This is a rebuildable cache, not the user's source. Quota pressure or a
    // transient cache write failure must not reject import, preview or export;
    // callers will decode the original and can retry the cache later.
    return null;
  }
  return remuxed.blob;
};

export const ensureAudioVariant = async (
  asset: AudioVariantAsset,
  deps: Deps = {},
): Promise<Blob | null> => {
  if (asset.kind === "image") return null;
  const key = audioVariantKey(asset);
  const cached = await readMediaFile(key);
  if (cached) return cached;

  const pending = pendingBuilds.get(key);
  if (pending) return pending;

  const build = buildAudioVariant(asset, key, deps).finally(() => {
    if (pendingBuilds.get(key) === build) pendingBuilds.delete(key);
  });
  pendingBuilds.set(key, build);
  return build;
};

// What audio consumers decode: the variant when one exists, else the original.
export const audioBlobFor = async (asset: AudioVariantAsset): Promise<Blob | null> => {
  const variant = await ensureAudioVariant(asset);
  if (variant) return variant;
  try {
    return await originalBlob(asset);
  } catch {
    return null;
  }
};
