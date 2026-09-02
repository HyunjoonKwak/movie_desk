import { describe, expect, it } from "vitest";
import type { MediaAsset, MediaClip, Project } from "@movie-desk/core";
import { addClip, createEmptyProject, newId, setPlayhead } from "@movie-desk/core";
import { useProjectStore } from "../project-store";

const makeAsset = (durationMs = 1000): MediaAsset => ({
  id: newId(),
  name: "clip.mp4",
  kind: "video",
  mime: "video/mp4",
  durationMs,
  opfsPath: "media/clip.mp4",
  importedAt: 0,
});

const makeMediaClip = (start = 0, duration = 1000): MediaClip => ({
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

const setup = (playhead = 0) => {
  const p0 = createEmptyProject();
  const video = p0.timeline.tracks[0]!;
  const existing = makeMediaClip(0, 2000);
  let p: Project = addClip(p0, video.id, existing);
  p = setPlayhead(p, playhead);
  useProjectStore.getState().loadProject(p);
  return { existing, videoTrackId: video.id };
};

const videoClips = () =>
  [...useProjectStore.getState().project.timeline.tracks[0]!.clips].sort(
    (a, b) => a.start - b.start,
  );

describe("placeAsset", () => {
  it("append (E) lands after the last clip regardless of playhead", () => {
    setup(500);
    const asset = makeAsset(1000);

    useProjectStore.getState().placeAsset(asset, "append");

    const clips = videoClips();
    expect(clips).toHaveLength(2);
    expect(clips[1]!.start).toBe(2000);
    expect((clips[1] as MediaClip).assetId).toBe(asset.id);
  });

  it("insert (W) splits at the playhead and ripples the tail", () => {
    const { existing } = setup(1000);
    const asset = makeAsset(500);

    useProjectStore.getState().placeAsset(asset, "insert");

    const clips = videoClips();
    expect(clips).toHaveLength(3);
    expect(clips[0]!.id).toBe(existing.id);
    expect(clips[0]!.duration).toBe(1000);
    expect((clips[1] as MediaClip).assetId).toBe(asset.id);
    expect(clips[1]!.start).toBe(1000);
    expect(clips[2]!.start).toBe(1500);
    expect(useProjectStore.getState().project.timeline.duration).toBe(2500);
  });

  it("overwrite (D) replaces the window without rippling", () => {
    setup(500);
    const asset = makeAsset(1000);

    useProjectStore.getState().placeAsset(asset, "overwrite");

    const clips = videoClips();
    expect(clips).toHaveLength(3);
    expect(clips[1]!.start).toBe(500);
    expect((clips[1] as MediaClip).assetId).toBe(asset.id);
    expect(useProjectStore.getState().project.timeline.duration).toBe(2000);
  });

  it("connect (Q) creates a lane ABOVE the primary (earlier index = on top)", () => {
    const { existing } = setup(500);
    const asset = makeAsset(1000);

    useProjectStore.getState().placeAsset(asset, "connect");

    const tracks = useProjectStore.getState().project.timeline.tracks;
    // new connected video lane + video + audio
    expect(tracks).toHaveLength(3);
    const lane = tracks[0]!;
    expect(lane.kind).toBe("video");
    expect(lane.connected).toBe(true);
    expect(lane.clips).toHaveLength(1);
    expect(lane.clips[0]!.start).toBe(500);
    // primary shifted down one slot, untouched
    expect(tracks[1]!.connected).toBeUndefined();
    expect(tracks[1]!.clips[0]!.id).toBe(existing.id);
  });

  it("connect (Q) reuses a free connected lane, else stacks a new one", () => {
    setup(500);

    useProjectStore.getState().placeAsset(makeAsset(1000), "connect");
    // same playhead: lane occupied → second lane between it and the primary
    useProjectStore.getState().placeAsset(makeAsset(500), "connect");
    expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(4);

    // free window: existing lane is reused, no new track
    useProjectStore.getState().setPlayheadMs(5000);
    useProjectStore.getState().placeAsset(makeAsset(500), "connect");
    expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(4);
  });

  it("append (E) targets the primary, skipping connected lanes", () => {
    setup(500);
    useProjectStore.getState().placeAsset(makeAsset(1000), "connect");

    useProjectStore.getState().placeAsset(makeAsset(500), "append");

    const tracks = useProjectStore.getState().project.timeline.tracks;
    // appended to the primary (existing 0–2000 → lands at 2000), not the lane
    expect(tracks[1]!.clips).toHaveLength(2);
    expect(tracks[0]!.clips).toHaveLength(1);
  });

  it("records no history entry when every candidate track is locked", () => {
    setup(0);
    const locked = {
      ...useProjectStore.getState().project,
      timeline: {
        ...useProjectStore.getState().project.timeline,
        tracks: useProjectStore
          .getState()
          .project.timeline.tracks.map((t) => ({ ...t, locked: true })),
      },
    };
    useProjectStore.getState().loadProject(locked);

    useProjectStore.getState().placeAsset(makeAsset(1000), "append");

    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });

  it("honours the asset's marked use-range", () => {
    setup(0);
    const asset: MediaAsset = { ...makeAsset(5000), useInMs: 1000, useOutMs: 2000 };

    useProjectStore.getState().placeAsset(asset, "append");

    const pasted = videoClips()[1] as MediaClip;
    expect(pasted.duration).toBe(1000);
    expect(pasted.trimIn).toBe(1000);
    expect(pasted.trimOut).toBe(2000);
  });
});
