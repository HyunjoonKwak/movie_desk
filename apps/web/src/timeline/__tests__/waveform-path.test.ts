import { describe, expect, it } from "vitest";
import { waveformPath } from "../waveform-path";

const ys = (path: string): number[] =>
  path
    .replace(/[MLZ]/g, " ")
    .trim()
    .split(/\s+/)
    .map((pair) => Number(pair.split(",")[1]));

describe("waveformPath", () => {
  it("centres a full-height waveform on the clip", () => {
    const path = waveformPath([1, 0.5], { width: 10, height: 40, from: 0, to: 1 })!;
    expect(Math.min(...ys(path))).toBe(0);
    expect(Math.max(...ys(path))).toBe(40);
    expect(ys(path)).toContain(10); // 0.5 peak → 10 above and below the 20 mid-line
  });
  it("keeps a banded waveform in the bottom of the clip", () => {
    const path = waveformPath([1, 1], { width: 10, height: 40, band: 0.4, from: 0, to: 1 })!;
    expect(Math.min(...ys(path))).toBe(24); // 40 − 16
    expect(Math.max(...ys(path))).toBe(40);
  });
  it("slices the visible source window and never returns an empty slice", () => {
    const peaks = [0, 0, 1, 1];
    const half = waveformPath(peaks, { width: 10, height: 10, from: 0.5, to: 1 })!;
    expect(half.split("L").length).toBe(4); // two peaks → four points
    expect(waveformPath(peaks, { width: 10, height: 10, from: 0.99, to: 0.99 })).not.toBeNull();
    expect(waveformPath([], { width: 10, height: 10, from: 0, to: 1 })).toBeNull();
  });
});
