import {
  type Clip,
  type ID,
  type MediaAsset,
  type Track,
  createEmptyProject,
} from "@movie-desk/core";
import { describe, expect, it, vi } from "vitest";
import { MediaSourceError, type RandomAccessMediaSource } from "../../media/source/media-source";
import { MissingMediaError, findMissingMedia, referencedClips } from "../preflight";

const asset = (id: string, name: string): MediaAsset => ({
  id: id as ID,
  name,
  kind: "video",
  mime: "video/mp4",
  durationMs: 10_000,
  opfsPath: `${id}__${name}`,
  sizeBytes: 1,
  importedAt: 0,
});

const mediaClip = (id: string, assetId: string, start: number, extra: Partial<Clip> = {}): Clip =>
  ({
    id: id as ID,
    kind: "media",
    assetId: assetId as ID,
    start,
    duration: 1_000,
    trimIn: 0,
    trimOut: 1_000,
    speed: 1,
    effects: [],
    keyframes: [],
    ...extra,
  }) as Clip;

const textClip = (id: string, start: number): Clip =>
  ({
    id: id as ID,
    kind: "text",
    start,
    duration: 1_000,
    speed: 1,
    effects: [],
    keyframes: [],
    text: "title",
  }) as unknown as Clip;

const projectWith = (
  tracks: readonly { clips: readonly Clip[]; muted?: boolean; solo?: boolean }[],
  assets: readonly MediaAsset[] = [],
) => {
  const base = createEmptyProject({ name: "preflight" });
  const template = base.timeline.tracks[0]!;
  return {
    ...base,
    mediaLibrary: [...assets],
    timeline: {
      ...base.timeline,
      tracks: tracks.map(
        (t, i): Track => ({
          ...template,
          id: `t${i}` as ID,
          clips: [...t.clips],
          muted: t.muted ?? false,
          solo: t.solo ?? false,
        }),
      ),
      duration: 5_000,
    },
  };
};

const source = (sizeBytes = 1, read = vi.fn(async () => new ArrayBuffer(1))) =>
  ({
    assetId: "x",
    sizeBytes,
    mime: "video/mp4",
    read,
    acquirePlaybackUrl: vi.fn(),
  }) as unknown as RandomAccessMediaSource;

const range = { start: 0, end: 5_000 };
const ids = (project: ReturnType<typeof projectWith>, r = range) =>
  referencedClips(project, r).map((ref) => ref.assetId);

describe("referencedClips", () => {
  it("keeps enabled media clips inside the range, one per asset", () => {
    const project = projectWith([
      {
        clips: [
          mediaClip("c1", "a", 0),
          mediaClip("c2", "a", 1_000),
          mediaClip("c3", "b", 4_000, { disabled: true }),
          mediaClip("c4", "c", 9_000),
          textClip("t1", 0),
        ],
      },
    ]);
    expect(ids(project)).toEqual(["a"]);
  });

  it("uses the export range, not the whole timeline", () => {
    const project = projectWith([
      { clips: [mediaClip("c1", "a", 0), mediaClip("c2", "b", 3_000)] },
    ]);
    expect(ids(project, { start: 2_500, end: 5_000 })).toEqual(["b"]);
  });

  it("skips muted tracks and, while soloing, every non-solo track", () => {
    const muted = projectWith([
      { clips: [mediaClip("c1", "a", 0)], muted: true },
      { clips: [mediaClip("c2", "b", 0)] },
    ]);
    expect(ids(muted)).toEqual(["b"]);

    const soloed = projectWith([
      { clips: [mediaClip("c1", "a", 0)] },
      { clips: [mediaClip("c2", "b", 0)], solo: true },
    ]);
    expect(ids(soloed)).toEqual(["b"]);
  });
});

describe("findMissingMedia", () => {
  const lib =
    (...assets: MediaAsset[]) =>
    (id: ID) =>
      assets.find((a) => a.id === id);

  it("reports nothing when every referenced asset resolves and reads", async () => {
    const project = projectWith([{ clips: [mediaClip("c1", "a", 0)] }]);
    const read = vi.fn(async () => new ArrayBuffer(1));
    const missing = await findMissingMedia(project, lib(asset("a", "trip.mp4")), range, async () =>
      source(1, read),
    );
    expect(missing).toEqual([]);
    expect(read).toHaveBeenCalledWith(0, 1);
  });

  it("names the asset whose source is gone and keeps its source state", async () => {
    const project = projectWith([
      { clips: [mediaClip("c1", "a", 0), mediaClip("c2", "b", 1_000)] },
    ]);
    const missing = await findMissingMedia(
      project,
      lib(asset("a", "trip.mp4"), asset("b", "beach.mov")),
      range,
      async (a) => {
        if (a.id === "b") throw new MediaSourceError("offline", "OPFS copy is missing");
        return source();
      },
    );
    expect(missing).toEqual([{ assetId: "b", name: "beach.mov", state: "offline" }]);
  });

  it("treats a source that opens but cannot be read, or is empty, as missing", async () => {
    const project = projectWith([
      { clips: [mediaClip("c1", "a", 0), mediaClip("c2", "b", 1_000)] },
    ]);
    const missing = await findMissingMedia(
      project,
      lib(asset("a", "trip.mp4"), asset("b", "beach.mov")),
      range,
      async (a) =>
        a.id === "a"
          ? source(
              1,
              vi.fn(async () => {
                throw new MediaSourceError("permission-denied", "range request returned HTTP 403");
              }),
            )
          : source(0),
    );
    expect(missing).toEqual([
      { assetId: "a", name: "trip.mp4", state: "permission-denied" },
      { assetId: "b", name: "beach.mov", state: "changed" },
    ]);
  });

  it("reports a clip whose asset left the library by label or timeline position", async () => {
    const project = projectWith([
      {
        clips: [mediaClip("c1", "ghost", 0, { label: "Old clip" }), mediaClip("c2", "gone", 2_500)],
      },
    ]);
    const missing = await findMissingMedia(
      project,
      () => undefined,
      range,
      async () => source(),
    );
    expect(missing).toEqual([
      { assetId: "ghost", name: "Old clip", state: "unknown" },
      { assetId: "gone", name: "clip @ 2.5s", state: "unknown" },
    ]);
  });

  it("classifies non-source failures as unknown", async () => {
    const project = projectWith([{ clips: [mediaClip("c1", "a", 0)] }]);
    const missing = await findMissingMedia(
      project,
      lib(asset("a", "trip.mp4")),
      range,
      async () => {
        throw new Error("boom");
      },
    );
    expect(missing[0]?.state).toBe("unknown");
  });
});

describe("MissingMediaError", () => {
  it("lists the file names in its message", () => {
    const error = new MissingMediaError([
      { assetId: "a" as ID, name: "trip.mp4", state: "offline" },
      { assetId: "b" as ID, name: "beach.mov", state: "unknown" },
    ]);
    expect(error.name).toBe("MissingMediaError");
    expect(error.message).toBe("Missing media: trip.mp4, beach.mov");
    expect(error.missing).toHaveLength(2);
  });
});
