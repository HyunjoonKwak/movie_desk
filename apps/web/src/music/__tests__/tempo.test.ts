import { describe, expect, it } from "vitest";
import type { MediaClip, Project } from "@movie-desk/core";
import { addClip, createEmptyProject, newId } from "@movie-desk/core";
import { bpmFit } from "../recommend";
import { projectCutBpm } from "../tempo";

const makeMediaClip = (start: number, duration: number): MediaClip => ({
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

// Back-to-back clips of equal length → evenly spaced edit points.
const projectWithCuts = (intervalMs: number, count: number): Project => {
  const p0 = createEmptyProject();
  const tid = p0.timeline.tracks[0]!.id;
  let p = p0;
  for (let i = 0; i < count; i++) {
    p = addClip(p, tid, makeMediaClip(i * intervalMs, intervalMs));
  }
  return p;
};

describe("projectCutBpm", () => {
  it("derives a musical tempo from evenly spaced cuts", () => {
    // 500ms cuts → 120 BPM directly
    expect(projectCutBpm(projectWithCuts(500, 8).timeline.tracks)).toBe(120);
  });

  it("normalizes slow cut rates into the musical range by doubling", () => {
    // 2s cuts → 30 → doubled into range → 60 (bpmFit treats half/double
    // time as equivalent, so 60 pairs with 120 BPM tracks too)
    expect(projectCutBpm(projectWithCuts(2000, 8).timeline.tracks)).toBe(60);
  });

  it("returns null when there are too few cuts to be meaningful", () => {
    expect(projectCutBpm(projectWithCuts(500, 2).timeline.tracks)).toBeNull();
    expect(projectCutBpm(createEmptyProject().timeline.tracks)).toBeNull();
  });

  it("ignores subtitle/text tracks so caption cues don't fake a tempo", () => {
    const base = projectWithCuts(3000, 8); // slow 3s cuts
    const textTrack = {
      id: newId(),
      kind: "text" as const,
      name: "Subtitles",
      height: 36,
      muted: false,
      solo: false,
      locked: false,
      clips: Array.from({ length: 20 }, (_, i) => ({
        kind: "text" as const,
        id: newId(),
        start: i * 400,
        duration: 350,
        speed: 1,
        effects: [],
        keyframes: [],
        text: "cue",
        font: "Inter",
        size: 40,
        color: "#fff",
      })),
    };
    const withSubs = [...base.timeline.tracks, textTrack];

    expect(projectCutBpm(withSubs)).toBe(projectCutBpm(base.timeline.tracks));
  });
});

describe("bpmFit", () => {
  it("is 1 for an exact match and decays with distance", () => {
    expect(bpmFit(120, 120)).toBe(1);
    expect(bpmFit(130, 120)).toBeCloseTo(0.5);
    expect(bpmFit(160, 120)).toBe(0);
  });

  it("accepts half- and double-time matches", () => {
    expect(bpmFit(60, 120)).toBe(1); // double-time
    expect(bpmFit(240, 120)).toBe(1); // half-time
  });

  it("is 0 for unusable inputs", () => {
    expect(bpmFit(0, 120)).toBe(0);
    expect(bpmFit(120, 0)).toBe(0);
  });
});
