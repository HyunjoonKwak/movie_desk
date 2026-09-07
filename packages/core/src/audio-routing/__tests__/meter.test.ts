import { describe, expect, it } from "vitest";
import { PeakHold, TruePeakMeter, measureSignal } from "../meter";

describe("audio metering", () => {
  it("measures silence, a sine, overlapping and cancelled tracks", () => {
    const sine = Float32Array.from(
      { length: 48000 },
      (_, i) => 0.6 * Math.sin((2 * Math.PI * 1000 * i) / 48000),
    );
    expect(measureSignal([sine])).toEqual({
      peak: expect.closeTo(0.6, 6),
      rms: expect.closeTo(0.6 / Math.sqrt(2), 6),
      clippedSamples: 0,
    });
    expect(measureSignal([sine.map((v) => v * 2)])).toEqual({
      peak: expect.closeTo(1.2, 6),
      rms: expect.closeTo(1.2 / Math.sqrt(2), 6),
      clippedSamples: 18000,
    });
    expect(measureSignal([sine.map((v) => v - v)])).toEqual({ peak: 0, rms: 0, clippedSamples: 0 });
  });
  it("holds peaks and clipping for 1.5 seconds without inventing RMS", () => {
    const hold = new PeakHold();
    hold.update({ peak: 1.1, rms: 0.7, clippedSamples: 1 }, 100);
    expect(hold.update({ peak: 0, rms: 0, clippedSamples: 0 }, 1599)).toMatchObject({
      heldPeak: 1.1,
      clipping: true,
      rms: 0,
    });
    expect(hold.update({ peak: 0, rms: 0, clippedSamples: 0 }, 1600)).toMatchObject({
      heldPeak: 0,
      clipping: false,
    });
  });
  it("oversamples between samples and is invariant to streaming boundaries", () => {
    const pcm = Float32Array.from(
      { length: 4800 },
      (_, i) => 1.1 * Math.sin((Math.PI * i) / 2 + Math.PI / 4),
    );
    const whole = new TruePeakMeter(1);
    whole.push([pcm]);
    const streamed = new TruePeakMeter(1);
    for (let at = 0; at < pcm.length; at += 37) streamed.push([pcm.subarray(at, at + 37)]);
    const result = whole.finish();
    expect(streamed.finish()).toEqual(result);
    expect(result.samplePeak).toBeLessThan(0.8);
    expect(result.truePeak).toBeGreaterThan(1.05);
    expect(result.clippedSamples).toBe(0);
  });
  it("counts pre-clamp normalized clipping and finite silence", () => {
    const meter = new TruePeakMeter(1);
    meter.push([Float32Array.of(0.6, -0.6, 0)], 2);
    expect(meter.finish()).toMatchObject({ clippedSamples: 2, samplePeak: expect.closeTo(1.2) });
    const silent = new TruePeakMeter();
    silent.push([new Float32Array(100), new Float32Array(100)]);
    expect(silent.finish()).toEqual({ clippedSamples: 0, samplePeak: 0, truePeak: 0 });
  });
});

it.each([1, 3])("rejects a %s-channel checkpoint before changing stereo state", (channels) => {
  const meter = new TruePeakMeter(2);
  meter.push([Float32Array.of(0.2), Float32Array.of(0.3)]);
  const before = meter.checkpoint();
  expect(() => meter.restore(new TruePeakMeter(channels).checkpoint())).toThrow("mismatch");
  expect(meter.checkpoint()).toEqual(before);
});
