import { describe, expect, it } from "vitest";
import { MAX_CLIP_GAIN, formatGain, gainAtY, yForGain } from "../clip-volume";

describe("clip volume line", () => {
  it("puts 100 % at mid-height and the extremes at the edges", () => {
    expect(yForGain(1, 40)).toBe(20);
    expect(yForGain(0, 40)).toBe(40);
    expect(yForGain(MAX_CLIP_GAIN, 40)).toBe(0);
    expect(yForGain(5, 40)).toBe(0);
  });
  it("inverts the mapping and clamps outside the clip", () => {
    expect(gainAtY(20, 40)).toBe(1);
    expect(gainAtY(0, 40)).toBe(MAX_CLIP_GAIN);
    expect(gainAtY(60, 40)).toBe(0);
    expect(gainAtY(-10, 40)).toBe(MAX_CLIP_GAIN);
    expect(gainAtY(yForGain(0.5, 40), 40)).toBeCloseTo(0.5);
  });
  it("reads out percent and decibels", () => {
    expect(formatGain(1)).toBe("100% · 0.0 dB");
    expect(formatGain(0.5)).toBe("50% · −6.0 dB");
    expect(formatGain(2)).toBe("200% · +6.0 dB");
    expect(formatGain(0)).toBe("0% · −∞ dB");
  });
});
