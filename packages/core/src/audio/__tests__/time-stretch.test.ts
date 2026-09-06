import { describe, expect, it } from "vitest";
import type { ID } from "../../utils/id";
import type { MediaClip } from "../../model/clip";
import { sourceOffsetForRamp } from "../../timeline/speed";
import { renderClipAudio } from "../time-stretch";

const sr = 48000;
const sine = (seconds: number) =>
  Float32Array.from({ length: sr * seconds }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / sr));
const clip = (speed: number): MediaClip => ({
  id: "clip" as ID,
  assetId: "asset" as ID,
  kind: "media",
  start: 0,
  duration: 2000 / speed,
  trimIn: 0,
  trimOut: 2000,
  speed,
  preservePitch: true,
  keyframes: [],
  effects: [],
});
const frequency = (pcm: Float32Array) => {
  let count = 0;
  for (let i = sr / 10 + 1; i < pcm.length - sr / 10; i++)
    if (pcm[i - 1]! <= 0 && pcm[i]! > 0) count++;
  return count / ((pcm.length - sr / 5) / sr);
};
const dominantHz = (pcm: Float32Array) => {
  const n = Math.min(16384, pcm.length - 9600);
  const windowed = Float32Array.from(
    { length: n },
    (_, i) => pcm[i + 4800]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))),
  );
  let bestPower = 0;
  let bestHz = 0;
  for (let hz = 200; hz <= 1000; hz += 2) {
    const coefficient = 2 * Math.cos((2 * Math.PI * hz) / sr);
    let a = 0;
    let b = 0;
    for (const value of windowed) {
      const next = value + coefficient * a - b;
      b = a;
      a = next;
    }
    const power = a * a + b * b - coefficient * a * b;
    if (power > bestPower) {
      bestPower = power;
      bestHz = hz;
    }
  }
  return bestHz;
};
const render = (
  source: Float32Array,
  c: MediaClip,
  offsetMs = 0,
  outputSamples = Math.round((c.duration * sr) / 1000),
) =>
  renderClipAudio({
    channels: [source, source.map((x) => -x)],
    sourceSampleRate: sr,
    outputSampleRate: sr,
    clip: c,
    offsetMs,
    outputSamples,
  });

describe("linked-channel WSOLA", () => {
  it.each([0.5, 2])("keeps 440Hz within 2%% at %s× and exact output length", (speed) => {
    const c = clip(speed);
    const [left, right] = render(sine(2), c);
    expect(Math.abs(frequency(left!) / 440 - 1)).toBeLessThan(0.02);
    expect(Math.abs(dominantHz(left!) / 440 - 1)).toBeLessThan(0.02);
    expect(left).toHaveLength(Math.round((c.duration * sr) / 1000));
    for (let i = 0; i < left!.length; i += 41) expect(left![i]! + right![i]!).toBeCloseTo(0, 6);
  });
  it("follows the core ramp integral and trim boundaries", () => {
    const c: MediaClip = {
      ...clip(1),
      duration: 2000,
      trimIn: 500,
      trimOut: 3000,
      keyframes: [
        {
          target: "speed",
          keyframes: [
            { at: 0, value: 0.5, easing: "linear" },
            { at: 2000, value: 2, easing: "linear" },
          ],
        },
      ],
    };
    expect(sourceOffsetForRamp(c, 2000)).toBeCloseTo(2492.5, 4);
    const [out] = render(sine(4), c);
    expect(out).toHaveLength(96000);
    expect(Math.abs(frequency(out!) / 440 - 1)).toBeLessThan(0.02);
    const [range] = render(sine(4), c, 1000, 48000);
    expect(Math.abs(frequency(range!) / 440 - 1)).toBeLessThan(0.02);
  });
  it.each([0, 1, 20, 48000])("handles silence and input length %s safely", (length) => {
    const [out] = render(new Float32Array(length), clip(2));
    expect(out!.every((v) => v === 0)).toBe(true);
  });
  it("does not read outside source trim", () => {
    const source = new Float32Array(sr * 2).fill(1);
    source.fill(0, sr / 2, sr);
    const [out] = render(source, { ...clip(0.5), trimIn: 500, trimOut: 1000, duration: 1000 });
    expect(out!.every((v) => v === 0)).toBe(true);
  });
  it("uses safe fallback for reverse and unsupported rates", () => {
    for (const speed of [-1, 0.1, 8]) {
      const [out] = render(sine(2), {
        ...clip(speed),
        duration: 200,
        trimIn: speed < 0 ? 1000 : 0,
      });
      expect(out!.every(Number.isFinite)).toBe(true);
      expect(out).toHaveLength(9600);
    }
  });
});

it("supported ramps override an unsupported constant speed hint", async () => {
  const { pitchHasUnsupportedRange } = await import("../time-stretch");
  const c = {
    ...clip(8),
    keyframes: [
      {
        target: "speed",
        keyframes: [
          { at: 0, value: 0.25, easing: "linear" as const },
          { at: 1000, value: 4, easing: "linear" as const },
        ],
      },
    ],
  };
  expect(pitchHasUnsupportedRange(c)).toBe(false);
  c.keyframes[0]!.keyframes[1]!.value = 5;
  expect(pitchHasUnsupportedRange(c)).toBe(true);
});
