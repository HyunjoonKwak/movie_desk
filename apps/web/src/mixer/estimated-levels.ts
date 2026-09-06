import {
  resolveTrackRoute,
  stereoPanMatrix,
  type MediaAsset,
  type Project,
} from "@movie-desk/core";
import { playheadLevel } from "@/preview/playhead-level";

type Waveforms = Readonly<Record<string, readonly number[]>>;
const assetMaps = new WeakMap<Project["mediaLibrary"], ReadonlyMap<string, MediaAsset>>();
export const meterAssets = (media: Project["mediaLibrary"]): ReadonlyMap<string, MediaAsset> => {
  let assets = assetMaps.get(media);
  if (!assets) {
    assets = new Map(media.map((asset) => [asset.id, asset]));
    assetMaps.set(media, assets);
  }
  return assets;
};
let cached:
  | {
      projectId: Project["id"];
      tracks: Project["timeline"]["tracks"];
      media: Project["mediaLibrary"];
      audio: Project["audio"];
      playhead: number;
      waveforms: Waveforms;
      levels: Readonly<Record<string, number>>;
    }
  | undefined;

// One estimate pass per frame, shared by track headers, strips, buses and master.
export const estimatedLevels = (
  project: Project,
  waveforms: Waveforms,
): Readonly<Record<string, number>> => {
  const { tracks, playhead } = project.timeline;
  if (
    cached &&
    cached.projectId === project.id &&
    cached.tracks === tracks &&
    cached.media === project.mediaLibrary &&
    cached.audio === project.audio &&
    cached.playhead === playhead &&
    cached.waveforms === waveforms
  )
    return cached.levels;
  const assets = meterAssets(project.mediaLibrary);
  const levels: Record<string, number> = { master: 0 };
  for (const track of tracks) {
    const route = resolveTrackRoute(project, track);
    const [ll, lr, rl, rr] = stereoPanMatrix(route.pan);
    const peak =
      route.trackGain *
      Math.max(ll + lr, rl + rr) *
      playheadLevel(
        { ...project, timeline: { ...project.timeline, tracks: [track] } },
        (id) => assets.get(id),
        (id) => assets.get(id)?.waveformPeaks ?? waveforms[id],
      );
    levels[`track:${track.id}`] = peak;
    const busPeak = peak * route.busGain;
    if (route.busId)
      levels[`bus:${route.busId}`] = Math.max(levels[`bus:${route.busId}`] ?? 0, busPeak);
    levels.master = Math.max(levels.master!, busPeak * route.masterGain);
  }
  cached = {
    projectId: project.id,
    tracks,
    playhead,
    media: project.mediaLibrary,
    audio: project.audio,
    waveforms,
    levels,
  };
  return levels;
};
