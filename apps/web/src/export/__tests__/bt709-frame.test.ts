import { describe, expect, it } from "vitest";
import { BT709_COLOR_SPACE, isBt709Output, rgbaToBt709I420 } from "../bt709-frame";
const patch = (rgb: number[]) =>
  Uint8Array.from(Array.from({ length: 4 }, () => [...rgb, 255]).flat());
describe("BT.709 export signal", () => {
  it("maps full-range black/white to limited luma with neutral chroma", () => {
    expect([...rgbaToBt709I420(patch([0, 0, 0]), 2, 2)]).toEqual([16, 16, 16, 16, 128, 128]);
    expect([...rgbaToBt709I420(patch([255, 255, 255]), 2, 2)]).toEqual([
      235, 235, 235, 235, 128, 128,
    ]);
  });
  it("uses BT.709 matrix coefficients and converts the sRGB transfer", () => {
    expect([...rgbaToBt709I420(patch([255, 0, 0]), 2, 2)]).toEqual([63, 63, 63, 63, 102, 240]);
    expect(rgbaToBt709I420(patch([118, 118, 118]), 2, 2)[0]).toBe(106);
  });
  it("flips GL rows once and rejects incomplete frames", () => {
    const input = Uint8Array.from([
      0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
    expect([...rgbaToBt709I420(input, 2, 2, undefined, true)].slice(0, 4)).toEqual([
      235, 235, 16, 16,
    ]);
    expect(() => rgbaToBt709I420(input, 3, 2)).toThrow("even dimensions");
  });
  it("rejects missing, incorrectly tagged or incorrectly ranged output", () => {
    expect(isBt709Output(BT709_COLOR_SPACE)).toBe(true);
    expect(isBt709Output(undefined)).toBe(false);
    expect(isBt709Output({ ...BT709_COLOR_SPACE, matrix: "smpte170m" })).toBe(false);
    expect(isBt709Output({ ...BT709_COLOR_SPACE, fullRange: true })).toBe(false);
  });
});
