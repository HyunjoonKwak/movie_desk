import { describe, expect, it } from "vitest";
import { framesToMs } from "@movie-desk/core";
import { parsePrecisionNumber, stepPrecisionValue } from "../precision-input-utils";

describe("strict precision numbers", () => {
  it.each(["", " ", "1abc", "Infinity", "NaN", "0x10", "1.2.3", "1,2,3", "1e309"])(
    "rejects %s",
    (text) => expect(parsePrecisionNumber(text)).toBeNull(),
  );
  it.each([
    ["0", 0],
    ["-1.25", -1.25],
    [".5", 0.5],
    [" 1,25 ", 1.25],
    ["+20", 20],
  ] as const)("parses %s", (text, value) => expect(parsePrecisionNumber(text)).toBe(value));
  it("steps, accelerates, fine steps and clamps without floating drift", () => {
    expect(stepPrecisionValue(1, 1)).toBe(2);
    expect(stepPrecisionValue(1, -1, { shift: true })).toBe(-9);
    expect(stepPrecisionValue(0.2, 1, { alt: true })).toBe(0.3);
    expect(stepPrecisionValue(2, 1, { max: 2 })).toBe(2);
    expect(stepPrecisionValue(0, -1, { min: 0 })).toBe(0);
    expect(stepPrecisionValue(0.1, 1, { step: 0.01, alt: true })).toBe(0.101);
  });
  it("does not move when the allowed interval contains no whole frame", () => {
    expect(stepPrecisionValue(5, 1, { fps: 30, min: 1, max: 10 })).toBe(5);
  });
  it.each([23.976, 29.97])("keeps steps and bounds on the %s frame grid", (fps) => {
    expect(stepPrecisionValue(0, 1, { fps })).toBeCloseTo(framesToMs(1, fps));
    expect(stepPrecisionValue(0, 1, { fps, shift: true })).toBeCloseTo(framesToMs(10, fps));
    expect(stepPrecisionValue(0, 1, { fps, alt: true })).toBeCloseTo(framesToMs(1, fps));
    expect(stepPrecisionValue(0, -1, { fps, min: 0 })).toBe(0);
    expect(stepPrecisionValue(1000, 1, { fps, max: 1000 })).toBeCloseTo(
      framesToMs(Math.floor(fps), fps),
    );
  });
});
