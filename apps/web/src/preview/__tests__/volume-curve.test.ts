import { describe, expect, it } from "vitest";
import type { KeyframeTrack } from "@movie-desk/core";
import { sampleVolumeCurve } from "../volume-curve";

const fade: KeyframeTrack = {
  target: "volume",
  keyframes: [
    { at: 1000, value: 1, easing: "linear" },
    { at: 2000, value: 0, easing: "linear" },
  ],
};

describe("sampleVolumeCurve", () => {
  it("samples the keyframed fade across the window", () => {
    const curve = sampleVolumeCurve(fade, 1, 1000, 2000, 5);

    expect(curve).toHaveLength(5);
    expect(curve[0]).toBeCloseTo(1);
    expect(curve[2]).toBeCloseTo(0.5);
    expect(curve[4]).toBeCloseTo(0);
  });

  it("holds the edge keyframe values outside the track range", () => {
    const curve = sampleVolumeCurve(fade, 1, 0, 500, 2);

    // before the first keyframe → first value
    expect(curve[0]).toBeCloseTo(1);
    expect(curve[1]).toBeCloseTo(1);
  });

  it("clamps negative values to silence", () => {
    const weird: KeyframeTrack = {
      target: "volume",
      keyframes: [
        { at: 0, value: -0.5, easing: "linear" },
        { at: 1000, value: 2, easing: "linear" },
      ],
    };

    const curve = sampleVolumeCurve(weird, 1, 0, 1000, 3);

    expect(curve[0]).toBe(0);
    expect(curve[2]).toBeCloseTo(2);
  });
});
