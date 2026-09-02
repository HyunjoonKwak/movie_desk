import type { ID, MediaClip } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { resampleClipAudio } from "../audio-mixer";

const clip = (speed: number, speedValues?: readonly [number, number][]): MediaClip => ({
  id: "clip" as ID,
  kind: "media",
  assetId: "asset" as ID,
  start: 0,
  duration: 4,
  trimIn: 0,
  trimOut: 28,
  speed,
  volume: 1,
  effects: [],
  keyframes: speedValues
    ? [
        {
          target: "speed",
          keyframes: speedValues.map(([at, value]) => ({ at, value, easing: "linear" as const })),
        },
      ]
    : [],
});

describe("resampleClipAudio", () => {
  const source = Float32Array.from({ length: 32 }, (_, index) => index);

  it("keeps constant-speed source stepping", () => {
    expect([...resampleClipAudio(source, 1000, 1000, clip(2))]).toEqual([0, 2, 4, 6]);
  });

  it("follows the instantaneous speed ramp instead of the base speed", () => {
    const ramped = clip(1, [
      [0, 1],
      [4, 4],
    ]);
    expect([...resampleClipAudio(source, 1000, 1000, ramped)]).toEqual([0, 1, 2, 5]);
  });
});
