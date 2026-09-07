import { describe, expect, it } from "vitest";
import {
  clipping,
  computeHistogram,
  computeLumaWaveform,
  computeParade,
  computeVectorscope,
  sampleSize,
} from "../compute";
const pixels = new Uint8ClampedArray([
  0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 128, 128, 128, 255,
]);
describe("display RGB scopes", () => {
  it("counts RGB and BT.709 encoded luma without treating alpha as a channel", () => {
    const h = computeHistogram(pixels);
    expect(h.r[255]).toBe(2);
    expect(h.g[0]).toBe(2);
    expect(h.luma[54]).toBe(1);
    expect(h.luma.reduce((a, b) => a + b, 0)).toBe(4);
    expect(computeHistogram(new Uint8ClampedArray()).max).toBe(1);
  });
  it("places black at 0 and white at 100 IRE and separates RGB parade columns", () => {
    const wave = computeLumaWaveform(pixels, 4, 1, 4);
    expect(wave.map[255 * 4]).toBe(16);
    expect(wave.map[1]).toBe(16);
    const parade = computeParade(pixels, 4, 1);
    expect(parade.cols).toBe(12);
    expect(parade.map[2]).toBe(16);
    expect(parade.map[255 * 12 + 6]).toBe(16);
    expect(parade.map[255 * 12 + 10]).toBe(16);
  });
  it("centers neutral patches and puts BT.709 red at expected Cb/Cr coordinates", () => {
    const grid = computeVectorscope(pixels);
    expect(grid[128 * 256 + 128]).toBe(72);
    // red: Cb=-0.2126/1.8556, Cr=0.5 -> (113,64)
    expect(grid[64 * 256 + 113]).toBe(24);
  });
  it("reports sampled any-channel near-clipping independently of alpha", () => {
    expect(clipping(pixels)).toEqual({ low: 2, high: 2, samples: 4 });
  });
  it("bounds landscape and portrait work, without upscaling", () => {
    expect(sampleSize(1920, 1080)).toEqual({ width: 256, height: 144 });
    expect(sampleSize(1080, 1920)).toEqual({ width: 81, height: 144 });
    expect(sampleSize(1, 1)).toEqual({ width: 1, height: 1 });
    expect(sampleSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
});
