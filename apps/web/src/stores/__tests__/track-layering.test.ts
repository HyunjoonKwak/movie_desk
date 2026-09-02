import { describe, expect, it } from "vitest";
import type { MediaAsset, MediaClip, Project } from "@movie-desk/core";
import { addClip, createEmptyProject, newId } from "@movie-desk/core";
import { applyPlanToProject } from "@/autoedit/apply";
import { replaceSubtitlesFromCues } from "@/subtitles/subtitle-utils";

// Layering rule under test: earlier track index composites ON TOP, so
// generated text/subtitle tracks must land above the video they caption.

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

const makeAsset = (durationMs = 4000): MediaAsset => ({
  id: newId(),
  name: "clip.mp4",
  kind: "video",
  mime: "video/mp4",
  durationMs,
  opfsPath: "media/clip.mp4",
  importedAt: 0,
});

describe("subtitle track layering", () => {
  it("creates the Subtitles track above the video tracks", () => {
    const p0 = createEmptyProject();
    const p1: Project = addClip(p0, p0.timeline.tracks[0]!.id, makeMediaClip());

    const p2 = replaceSubtitlesFromCues(p1, [{ start: 0, end: 1000, text: "hi" }]);

    const subsIdx = p2.timeline.tracks.findIndex((t) => t.name === "Subtitles");
    const videoIdx = p2.timeline.tracks.findIndex((t) => t.kind === "video");
    expect(subsIdx).toBeGreaterThanOrEqual(0);
    expect(subsIdx).toBeLessThan(videoIdx);
    expect(p2.timeline.tracks[subsIdx]!.clips).toHaveLength(1);
  });
});

describe("auto-edit track layering", () => {
  it("places the AUTO title track above the AUTO video track", () => {
    const asset = makeAsset();
    const p = applyPlanToProject(createEmptyProject(), {
      plan: {
        mode: "record",
        targetMs: 4000,
        items: [
          {
            assetId: asset.id,
            isPhoto: false,
            srcStartMs: 0,
            durationMs: 2000,
            reason: "test",
            chapter: "Day 1",
          },
        ],
        rejected: [],
      },
      assets: new Map([[asset.id, asset]]),
    });

    const videoIdx = p.timeline.tracks.findIndex((t) => t.name === "AUTO V");
    const titleIdx = p.timeline.tracks.findIndex((t) => t.name === "AUTO T");
    expect(videoIdx).toBeGreaterThanOrEqual(0);
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(titleIdx).toBeLessThan(videoIdx);
    expect(p.timeline.tracks[titleIdx]!.clips.length).toBeGreaterThan(0);
  });
});
