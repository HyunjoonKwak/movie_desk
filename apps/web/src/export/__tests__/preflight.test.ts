import { type Clip, type ID, type MediaAsset, createEmptyProject } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { MediaSourceError } from "../../media/source/media-source";
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

const projectWith = (clips: readonly Clip[], assets: readonly MediaAsset[]) => {
  const base = createEmptyProject({ name: "preflight" });
  const track = { ...base.timeline.tracks[0]!, clips: [...clips] };
  return {
    ...base,
    mediaLibrary: [...assets],
    timeline: { ...base.timeline, tracks: [track], duration: 5_000 },
  };
};

describe("referencedClips", () => {
  it("keeps enabled media clips inside the range, one per asset", () => {
    const project = projectWith(
      [
        mediaClip("c1", "a", 0),
        mediaClip("c2", "a", 1_000),
        mediaClip("c3", "b", 4_000, { disabled: true }),
        mediaClip("c4", "c", 9_000),
        textClip("t1", 0),
      ],
      [],
    );
    expect(referencedClips(project, { start: 0, end: 5_000 }).map((r) => r.assetId)).toEqual(["a"]);
  });

  it("uses the export range, not the whole timeline", () => {
    const project = projectWith([mediaClip("c1", "a", 0), mediaClip("c2", "b", 3_000)], []);
    expect(referencedClips(project, { start: 2_500, end: 5_000 }).map((r) => r.assetId)).toEqual([
      "b",
    ]);
  });
});

describe("findMissingMedia", () => {
  const range = { start: 0, end: 5_000 };

  it("reports nothing when every referenced asset resolves", async () => {
    const project = projectWith([mediaClip("c1", "a", 0)], [asset("a", "trip.mp4")]);
    const missing = await findMissingMedia(
      project,
      (id) => project.mediaLibrary.find((x) => x.id === id),
      range,
      async () => ({}),
    );
    expect(missing).toEqual([]);
  });

  it("names the asset whose source is gone and keeps its source state", async () => {
    const project = projectWith(
      [mediaClip("c1", "a", 0), mediaClip("c2", "b", 1_000)],
      [asset("a", "trip.mp4"), asset("b", "beach.mov")],
    );
    const missing = await findMissingMedia(
      project,
      (id) => project.mediaLibrary.find((x) => x.id === id),
      range,
      async (a) => {
        if (a.id === "b") throw new MediaSourceError("offline", "OPFS copy is missing");
        return {};
      },
    );
    expect(missing).toEqual([{ assetId: "b", name: "beach.mov", state: "offline" }]);
  });

  it("reports a clip whose asset left the library, using the clip label", async () => {
    const project = projectWith([mediaClip("c1", "ghost", 0, { label: "Old clip" })], []);
    const missing = await findMissingMedia(
      project,
      () => undefined,
      range,
      async () => ({}),
    );
    expect(missing).toEqual([{ assetId: "ghost", name: "Old clip", state: "unknown" }]);
  });

  it("classifies non-source failures as unknown", async () => {
    const project = projectWith([mediaClip("c1", "a", 0)], [asset("a", "trip.mp4")]);
    const missing = await findMissingMedia(
      project,
      (id) => project.mediaLibrary.find((x) => x.id === id),
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
