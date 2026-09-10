import {
  type ID,
  type MediaAsset,
  type MediaClip,
  type Project,
  createEmptyProject,
  syncRootTimeline,
} from "@movie-desk/core";

// The source viewer shows one asset through the same compositor and audio
// engine as the timeline, so colour, rotation and audio match what the
// clip will look like once placed. It does that by wrapping the asset in a
// one-clip project at the asset's own size.

export const SOURCE_PROJECT_PREFIX = "source:";

export const isSourceProjectId = (id: string): boolean => id.startsWith(SOURCE_PROJECT_PREFIX);

export const sourceResolution = (
  asset: Pick<MediaAsset, "width" | "height" | "rotation">,
  fallback: Project["resolution"],
): Project["resolution"] => {
  const { width, height } = asset;
  if (!width || !height) return fallback;
  const swapped = asset.rotation === 90 || asset.rotation === 270;
  return swapped ? { w: height, h: width } : { w: width, h: height };
};

interface CacheEntry {
  readonly key: string;
  readonly project: Project;
}

// Keyed on the asset record itself: an edited record (marks, relink, use
// range) is a new object, so the viewer never shows a stale asset.
const cache = new WeakMap<MediaAsset, CacheEntry>();

export const sourceProjectFor = (
  asset: MediaAsset,
  base: Pick<Project, "resolution" | "framerate">,
): Project => {
  const resolution = sourceResolution(asset, base.resolution);
  const key = `${resolution.w}x${resolution.h}@${base.framerate}`;
  const hit = cache.get(asset);
  if (hit && hit.key === key) return hit.project;

  // The whole file, never the use range: marking in/out happens here.
  const durationMs = Math.max(1, Math.round(asset.durationMs));
  const clip: MediaClip = {
    kind: "media",
    id: `${SOURCE_PROJECT_PREFIX}clip:${asset.id}` as ID,
    assetId: asset.id,
    start: 0,
    duration: durationMs,
    trimIn: 0,
    trimOut: durationMs,
    speed: 1,
    effects: [],
    keyframes: [],
    fit: "fit",
  };
  const empty = createEmptyProject({
    id: `${SOURCE_PROJECT_PREFIX}${asset.id}` as ID,
    name: asset.name,
    resolution,
    framerate: base.framerate,
    mediaLibrary: [asset],
  });
  const kind = asset.kind === "audio" ? "audio" : "video";
  let placed = false;
  const tracks = empty.timeline.tracks.map((track) => {
    if (placed || track.kind !== kind) return track;
    placed = true;
    return { ...track, clips: [clip] };
  });
  const project = syncRootTimeline({
    ...empty,
    timeline: { ...empty.timeline, tracks, duration: durationMs },
  });
  cache.set(asset, { key, project });
  return project;
};
