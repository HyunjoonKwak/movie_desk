import type { RandomAccessMediaSource } from "@/media/source/media-source";
import { probeAssetSource } from "@/media/source/probe-source";
import { resolveMediaSource } from "@/media/source/resolve-media-source";
import {
  type ID,
  type MediaAsset,
  type MediaSourceState,
  type Ms,
  type Project,
  clipEnd,
} from "@movie-desk/core";

// Export preflight (release checklist B24): every media clip that would land
// in the output must still have its bytes. Without this check a missing OPFS
// copy or a disconnected drive renders as black frames and silence, and the
// export "succeeds" — the one failure the product rules say must be
// understandable instead.

export interface MissingMedia {
  readonly assetId: ID;
  readonly name: string;
  readonly state: MediaSourceState | "unknown";
}

export class MissingMediaError extends Error {
  readonly missing: readonly MissingMedia[];

  constructor(missing: readonly MissingMedia[], options?: ErrorOptions) {
    super(`Missing media: ${missing.map((m) => m.name).join(", ")}`, options);
    this.name = "MissingMediaError";
    this.missing = missing;
  }
}

export interface ExportRange {
  readonly start: Ms;
  readonly end: Ms;
}

type ClipRef = { readonly assetId: ID; readonly fallbackName: string };

const clipLabel = (clip: { label?: string; start: Ms }): string =>
  clip.label ?? `clip @ ${(clip.start / 1000).toFixed(1)}s`;

// Media clips that reach the output: on tracks the renderer and the mixer
// keep (not muted; only solo tracks while any track is soloed), not disabled,
// and overlapping the export range. One entry per asset, timeline order.
export const referencedClips = (project: Project, range: ExportRange): readonly ClipRef[] => {
  const soloing = project.timeline.tracks.some((track) => track.solo);
  const seen = new Set<ID>();
  const refs: ClipRef[] = [];
  for (const track of project.timeline.tracks) {
    if (track.muted || (soloing && !track.solo)) continue;
    for (const clip of track.clips) {
      if (clip.kind !== "media" || clip.disabled) continue;
      if (clipEnd(clip) <= range.start || clip.start >= range.end) continue;
      if (seen.has(clip.assetId)) continue;
      seen.add(clip.assetId);
      refs.push({ assetId: clip.assetId, fallbackName: clipLabel(clip) });
    }
  }
  return refs;
};

// Checks each referenced asset once. An asset that is gone from the library
// or whose source cannot be opened and read is reported with the best name
// available: the file name, else the clip label or its timeline position.
export const findMissingMedia = async (
  project: Project,
  getAsset: (id: ID) => MediaAsset | undefined,
  range: ExportRange,
  resolve: (asset: MediaAsset) => Promise<RandomAccessMediaSource> = resolveMediaSource,
): Promise<readonly MissingMedia[]> => {
  const checks = referencedClips(project, range).map(async (ref): Promise<MissingMedia | null> => {
    const asset = getAsset(ref.assetId);
    if (!asset) return { assetId: ref.assetId, name: ref.fallbackName, state: "unknown" };
    const health = await probeAssetSource(asset, resolve);
    return health === "ok" ? null : { assetId: asset.id, name: asset.name, state: health };
  });
  return (await Promise.all(checks)).filter((m): m is MissingMedia => m !== null);
};
