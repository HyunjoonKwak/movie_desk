import { type MediaAsset, createEmptyProject, isMediaClip, newId } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { SOURCE_PROJECT_PREFIX, sourceProjectFor, sourceResolution } from "../source-project";

const asset = (over: Partial<MediaAsset> = {}): MediaAsset =>
  ({
    id: newId(),
    name: "clip.mp4",
    kind: "video",
    mime: "video/mp4",
    durationMs: 4000,
    opfsPath: "clip.mp4",
    importedAt: 1,
    width: 1280,
    height: 720,
    ...over,
  }) as MediaAsset;
const withoutSize = (a: MediaAsset): MediaAsset => {
  const { width: _w, height: _h, ...rest } = a;
  return rest as MediaAsset;
};
const base = createEmptyProject();

describe("sourceResolution", () => {
  it("uses the asset's own size and swaps it for a 90/270 display rotation", () => {
    expect(sourceResolution(asset(), base.resolution)).toEqual({ w: 1280, h: 720 });
    expect(sourceResolution(asset({ rotation: 90 }), base.resolution)).toEqual({ w: 720, h: 1280 });
    expect(sourceResolution(asset({ rotation: 180 }), base.resolution)).toEqual({
      w: 1280,
      h: 720,
    });
  });
  it("falls back to the project resolution for audio and unknown sizes", () => {
    expect(sourceResolution(withoutSize(asset()), base.resolution)).toEqual(base.resolution);
  });
});

describe("sourceProjectFor", () => {
  it("wraps the whole asset in one clip on a track of its kind, at native size", () => {
    const a = asset();
    const project = sourceProjectFor(a, base);
    expect(project.id).toBe(`${SOURCE_PROJECT_PREFIX}${a.id}`);
    expect(project.resolution).toEqual({ w: 1280, h: 720 });
    expect(project.framerate).toBe(base.framerate);
    expect(project.mediaLibrary).toEqual([a]);
    expect(project.timeline.duration).toBe(4000);
    const clips = project.timeline.tracks.flatMap((t) => t.clips.map((c) => [t.kind, c] as const));
    expect(clips).toHaveLength(1);
    const [kind, clip] = clips[0]!;
    expect(kind).toBe("video");
    expect(isMediaClip(clip) && clip).toMatchObject({
      assetId: a.id,
      start: 0,
      duration: 4000,
      trimIn: 0,
      trimOut: 4000,
      speed: 1,
      fit: "fit",
    });
    // Nested-timeline invariants hold, so the compositor and audio engine accept it.
    expect(project.timelines.find((t) => t.id === project.rootTimelineId)).toBe(project.timeline);
  });

  it("puts an audio asset on the audio track", () => {
    const a = withoutSize(asset({ kind: "audio", mime: "audio/wav" }));
    const project = sourceProjectFor(a, base);
    const track = project.timeline.tracks.find((t) => t.clips.length > 0);
    expect(track?.kind).toBe("audio");
    expect(project.resolution).toEqual(base.resolution);
  });

  it("returns the same project for the same asset record and rebuilds when the record changes", () => {
    const a = asset();
    expect(sourceProjectFor(a, base)).toBe(sourceProjectFor(a, base));
    const marked = { ...a, useInMs: 1000, useOutMs: 2000 };
    expect(sourceProjectFor(marked, base)).not.toBe(sourceProjectFor(a, base));
    // The use-range never trims the source view: the viewer shows the whole file.
    const clip = sourceProjectFor(marked, base).timeline.tracks.flatMap((t) => t.clips)[0]!;
    expect(isMediaClip(clip) && clip.trimIn).toBe(0);
  });
});
