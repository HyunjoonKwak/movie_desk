import { describe, expect, it } from "vitest";
import { createSamplePicker, planSampleRuns, remainingTimes } from "../frame-sampler";

// The sampler decodes each run once, in order, and serves every requested
// time with the first decoded frame at or after it. These are the pure
// decisions behind that; the WebCodecs plumbing is exercised in the browser.
describe("planSampleRuns", () => {
  it("splits sorted, de-duplicated times where the gap exceeds the threshold", () => {
    expect(planSampleRuns([5000, 500, 1500, 500, 9000, 9120, 9240], 2500)).toEqual([
      [500, 1500],
      [5000],
      [9000, 9120, 9240],
    ]);
  });

  it("returns no runs for no times", () => {
    expect(planSampleRuns([], 2500)).toEqual([]);
  });
});

describe("createSamplePicker", () => {
  it("serves each request with the frame displayed at its time", () => {
    const picker = createSamplePicker([1000, 1000, 2000, 2500]);
    expect(picker.take(500_000)).toEqual({ byPrevious: [], byCurrent: [] });
    // Exact hit serves both duplicates once.
    expect(picker.take(1_000_000)).toEqual({ byPrevious: [], byCurrent: [1000] });
    expect(picker.take(1_950_000)).toEqual({ byPrevious: [], byCurrent: [] });
    // 2000 was on screen from 1.95 s; 2500 falls inside the 2.6 s frame's
    // predecessor too.
    expect(picker.take(2_600_000)).toEqual({ byPrevious: [2000, 2500], byCurrent: [] });
    expect(picker.remaining()).toEqual([]);
    expect(picker.done).toBe(true);
  });

  it("uses the first frame for requests before it and reports what is pending", () => {
    const picker = createSamplePicker([0, 100, 4000]);
    expect(picker.take(67_000)).toEqual({ byPrevious: [], byCurrent: [0] });
    expect(picker.take(133_000)).toEqual({ byPrevious: [100], byCurrent: [] });
    expect(picker.done).toBe(false);
    expect(picker.remaining()).toEqual([4000]);
  });
});

describe("remainingTimes", () => {
  it("hands the fallback only what WebCodecs did not serve, sorted and unique", () => {
    expect(remainingTimes([900, 100, 500, 500, -5], new Set([100, 500]))).toEqual([0, 900]);
    expect(remainingTimes([100, 200], new Set([100, 200]))).toEqual([]);
  });
});

describe("planSampleRuns with keyframes", () => {
  it("decodes through a single intervening keyframe but seeks past whole GOPs", () => {
    // Keyframes every second. 400→1200 crosses one keyframe: keep streaming.
    // 1300→3900 crosses 2000 and 3000: the 2–3 s GOP is skipped by seeking.
    expect(planSampleRuns([0, 400, 1200, 1300, 3900], 10_000, [0, 1000, 2000, 3000])).toEqual([
      [0, 400, 1200, 1300],
      [3900],
    ]);
  });

  it("ignores the gap rule once keyframes are known", () => {
    expect(planSampleRuns([0, 5000, 9000], 100, [0])).toEqual([[0, 5000, 9000]]);
  });
});
