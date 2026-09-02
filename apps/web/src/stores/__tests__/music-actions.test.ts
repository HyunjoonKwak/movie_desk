import { describe, expect, it } from "vitest";
import type { MediaAsset, MediaClip, Project } from "@movie-desk/core";
import { createEmptyProject, newId } from "@movie-desk/core";
import { addClip } from "@movie-desk/core";
import { useProjectStore } from "../project-store";

const makeAudioAsset = (durationMs = 120_000): MediaAsset => ({
  id: newId(),
  name: "song.mp3",
  kind: "audio",
  mime: "audio/mpeg",
  durationMs,
  opfsPath: "media/song.mp3",
  importedAt: 0,
});

const makeMediaClip = (start = 0, duration = 60_000): MediaClip => ({
  kind: "media",
  id: newId(),
  assetId: newId(),
  start,
  duration,
  trimIn: 0,
  trimOut: duration,
  speed: 1,
  effects: [],
  keyframes: [],
});

// Project with 60s of video and one audio asset in the library.
const setup = (assetDurationMs = 120_000) => {
  const p0 = createEmptyProject();
  const asset = makeAudioAsset(assetDurationMs);
  let p: Project = addClip(p0, p0.timeline.tracks[0]!.id, makeMediaClip(0, 60_000));
  p = { ...p, mediaLibrary: [asset] };
  useProjectStore.getState().loadProject(p);
  return { asset };
};

const musicTracks = () =>
  useProjectStore.getState().project.timeline.tracks.filter((t) => t.name === "Music");

describe("addMusicBed", () => {
  it("lays the track from 0, capped to the timeline, with a tail fade", () => {
    const { asset } = setup(120_000);

    useProjectStore.getState().addMusicBed(asset.id);

    const tracks = musicTracks();
    expect(tracks).toHaveLength(1);
    const clip = tracks[0]!.clips[0]! as MediaClip;
    expect(clip.start).toBe(0);
    expect(clip.duration).toBe(60_000); // min(asset 120s, timeline 60s)
    expect(clip.assetId).toBe(asset.id);
    const fade = clip.keyframes.find((k) => k.target === "volume")!;
    expect(fade.keyframes.at(-1)!.at).toBe(60_000);
    expect(fade.keyframes.at(-1)!.value).toBe(0);
  });

  it("uses the full song length when it is shorter than the timeline", () => {
    const { asset } = setup(30_000);

    useProjectStore.getState().addMusicBed(asset.id);

    const clip = musicTracks()[0]!.clips[0]!;
    expect(clip.duration).toBe(30_000); // asset shorter than timeline
  });

  it("fills the remaining room and never extends the program", () => {
    const { asset } = setup(30_000);

    expect(useProjectStore.getState().addMusicBed(asset.id)).toBe(true);
    expect(useProjectStore.getState().addMusicBed(asset.id)).toBe(true);

    const tracks = musicTracks();
    expect(tracks).toHaveLength(1);
    const [a, b] = [...tracks[0]!.clips].sort((x, y) => x.start - y.start);
    expect(a!.start + a!.duration).toBe(30_000);
    expect(b!.start).toBe(30_000);
    expect(b!.start + b!.duration).toBe(60_000);
    // program length unchanged — beds must never grow the timeline
    expect(useProjectStore.getState().project.timeline.duration).toBe(60_000);
  });

  it("refuses when the timeline is already covered", () => {
    const { asset } = setup(120_000);

    expect(useProjectStore.getState().addMusicBed(asset.id)).toBe(true);
    expect(useProjectStore.getState().addMusicBed(asset.id)).toBe(false);

    expect(musicTracks()[0]!.clips).toHaveLength(1);
    expect(useProjectStore.getState().project.timeline.duration).toBe(60_000);
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it("honours the asset's marked use-range", () => {
    const { asset } = setup(120_000);
    const ranged = { ...asset, useInMs: 10_000, useOutMs: 40_000 };
    useProjectStore.getState().loadProject({
      ...useProjectStore.getState().project,
      mediaLibrary: [ranged],
    });

    useProjectStore.getState().addMusicBed(ranged.id);

    const clip = musicTracks()[0]!.clips[0]! as MediaClip;
    expect(clip.duration).toBe(30_000); // 40s - 10s range
    expect(clip.trimIn).toBe(10_000);
    expect(clip.trimOut).toBe(40_000);
  });

  it("records one undo entry, and none for an unknown or non-audio asset", () => {
    const { asset } = setup(120_000);

    useProjectStore.getState().addMusicBed(asset.id);
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    expect(useProjectStore.getState().addMusicBed(newId())).toBe(false);
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });
});
