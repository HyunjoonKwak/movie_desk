import { resolveMediaSource } from "@/media/source/resolve-media-source";
import type { ID, MediaAsset, MediaSourceState, Ms, Project } from "@movie-desk/core";

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

type ClipRef = { readonly assetId: ID; readonly label: string | undefined };

// Media clips that overlap the export range and are not disabled, in
// timeline order, one entry per asset.
export const referencedClips = (project: Project, range: ExportRange): readonly ClipRef[] => {
  const seen = new Set<ID>();
  const refs: ClipRef[] = [];
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.kind !== "media" || clip.disabled) continue;
      if (clip.start + clip.duration <= range.start || clip.start >= range.end) continue;
      if (seen.has(clip.assetId)) continue;
      seen.add(clip.assetId);
      refs.push({ assetId: clip.assetId, label: clip.label });
    }
  }
  return refs;
};

const stateOf = (error: unknown): MissingMedia["state"] =>
  error instanceof Error && error.name === "MediaSourceError" && "state" in error
    ? (error as { state: MediaSourceState }).state
    : "unknown";

// Resolves each referenced asset once. An asset that is gone from the library
// or whose source cannot be opened is reported with the best name we have.
export const findMissingMedia = async (
  project: Project,
  getAsset: (id: ID) => MediaAsset | undefined,
  range: ExportRange,
  resolve: (asset: MediaAsset) => Promise<unknown> = resolveMediaSource,
): Promise<readonly MissingMedia[]> => {
  const checks = referencedClips(project, range).map(async (ref): Promise<MissingMedia | null> => {
    const asset = getAsset(ref.assetId);
    if (!asset) return { assetId: ref.assetId, name: ref.label ?? ref.assetId, state: "unknown" };
    try {
      await resolve(asset);
      return null;
    } catch (error) {
      return { assetId: asset.id, name: asset.name, state: stateOf(error) };
    }
  });
  return (await Promise.all(checks)).filter((m): m is MissingMedia => m !== null);
};
