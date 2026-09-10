import { type Project, clipTransform, isMediaClip } from "@movie-desk/core";

// When the linear-light pipeline landed (commit 8cf9505). A project created
// after this has only ever been rendered linearly, so there is nothing to
// migrate and the "existing project" notice would be misleading.
export const LINEAR_COLOR_PIPELINE_SINCE = Date.UTC(2026, 8, 7, 3, 37, 8);

export interface LinearColorHintInput {
  readonly createdAt: Project["createdAt"];
  readonly tracks: Project["timeline"]["tracks"];
  readonly mediaLibrary: Project["mediaLibrary"];
  readonly resolution: Project["resolution"];
}

// True when an older project's look could have changed with the pipeline:
// any clip that blends, scales, masks, or runs a visual effect, or two or
// more clips that composite over each other.
export const needsLinearColorMigrationHint = (input: LinearColorHintInput): boolean => {
  if (input.createdAt >= LINEAR_COLOR_PIPELINE_SINCE) return false;
  const clips = input.tracks.flatMap((track) => track.clips);
  if (clips.length >= 2) return true;
  return clips.some((clip) => {
    const transform = clipTransform(clip);
    const asset = isMediaClip(clip)
      ? input.mediaLibrary.find((asset) => asset.id === clip.assetId)
      : undefined;
    return (
      clip.effects.some((fx) => fx.enabled && !fx.type.startsWith("audio-")) ||
      !!clip.mask ||
      transform.opacity !== 1 ||
      transform.scale !== 1 ||
      transform.rotation !== 0 ||
      transform.x !== 0 ||
      transform.y !== 0 ||
      (isMediaClip(clip) && !!clip.fit && clip.fit !== "stretch") ||
      !!asset?.rotation ||
      asset?.kind === "image" ||
      (!!asset && (asset.width !== input.resolution.w || asset.height !== input.resolution.h))
    );
  });
};
