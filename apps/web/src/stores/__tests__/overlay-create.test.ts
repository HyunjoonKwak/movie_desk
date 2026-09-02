import { describe, expect, it } from "vitest";
import type { MediaClip, Project } from "@movie-desk/core";
import { addClip, addTrack, createEmptyProject, newId, setPlayhead } from "@movie-desk/core";
import { useProjectStore } from "../project-store";

const makeMediaClip = (start = 0, duration = 5000): MediaClip => ({
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

// V1 holds a media clip covering the playhead — the case where a title
// placed on or below V1 would collide or be hidden (tracks[0] composites
// on top).
const setup = () => {
  const p0 = createEmptyProject();
  const video = p0.timeline.tracks[0]!;
  let p: Project = addClip(p0, video.id, makeMediaClip(0, 5000));
  p = setPlayhead(p, 1000);
  useProjectStore.getState().loadProject(p);
  return { videoTrackId: video.id };
};

const tracks = () => useProjectStore.getState().project.timeline.tracks;
const primaryIdx = () => tracks().findIndex((t) => t.kind === "video" && !t.connected);

describe("overlay-family clip creation sits above the primary video track", () => {
  it("title template goes on an overlay lane above the primary, never on V1", () => {
    const { videoTrackId } = setup();

    useProjectStore.getState().addTitleTemplate("title");

    const primary = tracks().find((t) => t.id === videoTrackId)!;
    expect(primary.clips).toHaveLength(1); // untouched media clip only
    const overlayIdx = tracks().findIndex((t) => t.kind === "overlay");
    expect(overlayIdx).toBeGreaterThanOrEqual(0);
    expect(overlayIdx).toBeLessThan(primaryIdx());
    expect(tracks()[overlayIdx]!.clips).toHaveLength(1);
  });

  it("title template reuses the upper overlay lane on repeat", () => {
    setup();

    useProjectStore.getState().addTitleTemplate("title");
    useProjectStore.getState().addTitleTemplate("subtitle");

    expect(tracks().filter((t) => t.kind === "overlay")).toHaveLength(1);
  });

  it("text clip goes on a text track above the primary", () => {
    setup();

    useProjectStore.getState().addTextClipAtPlayhead("Hello");

    const textIdx = tracks().findIndex((t) => t.kind === "text");
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(textIdx).toBeLessThan(primaryIdx());
    expect(tracks()[textIdx]!.clips).toHaveLength(1);
  });

  it("text creation ignores a legacy text track buried below the video", () => {
    const p0 = createEmptyProject();
    const video = p0.timeline.tracks[0]!;
    let p: Project = addClip(p0, video.id, makeMediaClip(0, 5000));
    // legacy layout: text track appended at the bottom (hidden layer)
    p = addTrack(p, {
      kind: "text",
      name: "T1",
      height: 48,
      muted: false,
      solo: false,
      locked: false,
    });
    useProjectStore.getState().loadProject(p);

    useProjectStore.getState().addTextClipAtPlayhead("Hello");

    const textTracks = tracks().filter((t) => t.kind === "text");
    expect(textTracks).toHaveLength(2);
    // the clip landed on the NEW upper track, not the buried one
    const upperIdx = tracks().findIndex((t) => t.kind === "text");
    expect(upperIdx).toBeLessThan(primaryIdx());
    expect(tracks()[upperIdx]!.clips).toHaveLength(1);
  });

  it("shape clip never lands on the primary video track", () => {
    const { videoTrackId } = setup();

    useProjectStore.getState().addShapeClipAtPlayhead("rect");

    const primary = tracks().find((t) => t.id === videoTrackId)!;
    expect(primary.clips).toHaveLength(1); // media clip only, no collision
    const overlayIdx = tracks().findIndex((t) => t.kind === "overlay");
    expect(overlayIdx).toBeLessThan(primaryIdx());
    expect(tracks()[overlayIdx]!.clips).toHaveLength(1);
  });

  it("adjustment layer sits above the content it grades", () => {
    setup();

    useProjectStore.getState().addAdjustmentClipAtPlayhead();

    const overlayIdx = tracks().findIndex((t) => t.kind === "overlay");
    expect(overlayIdx).toBeLessThan(primaryIdx());
    expect(tracks()[overlayIdx]!.clips[0]!.kind).toBe("adjustment");
  });

  it("never hijacks the reserved Subtitles lane for manual text", () => {
    const p0 = createEmptyProject();
    let p: Project = addClip(p0, p0.timeline.tracks[0]!.id, makeMediaClip(0, 5000));
    p = {
      ...p,
      timeline: {
        ...p.timeline,
        tracks: [
          {
            id: newId(),
            kind: "text" as const,
            name: "Subtitles",
            height: 36,
            muted: false,
            solo: false,
            locked: false,
            clips: [],
          },
          ...p.timeline.tracks,
        ],
      },
    };
    useProjectStore.getState().loadProject(p);

    useProjectStore.getState().addTextClipAtPlayhead("Manual title");

    const subs = tracks().find((t) => t.name === "Subtitles")!;
    expect(subs.clips).toHaveLength(0); // untouched — SRT re-import may wipe it
    const manual = tracks().filter((t) => t.kind === "text" && t.name !== "Subtitles");
    expect(manual).toHaveLength(1);
    expect(manual[0]!.clips).toHaveLength(1);
  });

  it("creates a fresh top lane when every upper candidate is locked", () => {
    const p0 = createEmptyProject();
    let p: Project = addClip(p0, p0.timeline.tracks[0]!.id, makeMediaClip(0, 5000));
    p = {
      ...p,
      timeline: {
        ...p.timeline,
        tracks: [
          {
            id: newId(),
            kind: "text" as const,
            name: "T1",
            height: 48,
            muted: false,
            solo: false,
            locked: true,
            clips: [],
          },
          ...p.timeline.tracks,
        ],
      },
    };
    useProjectStore.getState().loadProject(p);

    useProjectStore.getState().addTextClipAtPlayhead("Hello");

    expect(tracks()[0]!.locked).toBe(false);
    expect(tracks()[0]!.clips).toHaveLength(1);
  });

  it("still works when the project has no video track at all", () => {
    const p0 = createEmptyProject();
    const audioOnly: Project = {
      ...p0,
      timeline: { ...p0.timeline, tracks: p0.timeline.tracks.filter((t) => t.kind === "audio") },
    };
    useProjectStore.getState().loadProject(audioOnly);

    useProjectStore.getState().addTextClipAtPlayhead("Hello");

    expect(tracks()[0]!.kind).toBe("text");
    expect(tracks()[0]!.clips).toHaveLength(1);
  });

  it("lower-third renders its text above the backing bar", () => {
    setup();

    useProjectStore.getState().addTitleTemplate("lowerThird");

    const overlay = tracks().find((t) => t.kind === "overlay")!;
    // earliest-added same-start clip composites on top → text must precede
    // the shape in the clip array
    const kinds = overlay.clips.map((c) => c.kind);
    expect(kinds.indexOf("text")).toBeLessThan(kinds.indexOf("shape"));
  });
});
