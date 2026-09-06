import { describe, expect, it } from "vitest";
import type { MediaClip } from "../../model/clip";
import { sourceOffsetForRamp } from "../../timeline/speed";
import type { ID } from "../../utils/id";
import { type StretchContinuation, renderClipAudio } from "../time-stretch";

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
const dominantHz = (pcm: Float32Array, expected = 440) => {
  const n = Math.min(16384, pcm.length - 9600);
  const windowed = Float32Array.from(
    { length: n },
    (_, i) => pcm[i + 4800]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))),
  );
  let bestPower = 0;
  let bestHz = 0;
  for (let hz = Math.max(20, expected - 800); hz <= expected + 800; hz += 2) {
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
const renderResult = (
  source: Float32Array,
  c: MediaClip,
  offsetMs = 0,
  outputSamples = Math.round((c.duration * sr) / 1000),
  continuation?: StretchContinuation,
) =>
  renderClipAudio({
    ...(continuation ? { continuation } : {}),
    channels: [source, source.map((x) => -x)],
    sourceSampleRate: sr,
    outputSampleRate: sr,
    clip: c,
    offsetMs,
    outputSamples,
  });

const render = (...args: Parameters<typeof renderResult>) => renderResult(...args).channels;

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

// Noninteger periods exercise alignment beyond the exact 48kHz/440Hz fixtures.
it.each([6000, 10000])("preserves high-frequency %sHz tones", (hz) => {
  const source = Float32Array.from({ length: sr * 2 }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / sr),
  );
  for (const speed of [0.5, 1.37, 2]) {
    const [out] = render(source, clip(speed));
    expect(Math.abs(dominantHz(out!, hz) / hz - 1)).toBeLessThan(0.02);
  }
});
it.each([0.5, 1.37, 2])(
  "keeps 30s chunk boundary continuous at %sx",
  (speed) => {
    const source = Float32Array.from(
      { length: sr * 62 },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 443 * i) / sr),
    );
    const c = { ...clip(speed), duration: 31000, trimOut: 62000 };
    const {
      channels: [a],
      continuation,
    } = renderResult(source, c, 0, sr * 30);
    const [b] = render(source, c, 30000, sr / 10, continuation);
    expect(Math.abs(b![0]! - a!.at(-1)!)).toBeLessThan(0.05);
  },
  20000,
);
it("sanitizes nonfinite PCM before correlation and interpolation", () => {
  const source = sine(2);
  source[123] = Number.NaN;
  source[4800] = Number.POSITIVE_INFINITY;
  const [out] = render(source, clip(0.5));
  expect(out!.every(Number.isFinite)).toBe(true);
});

it("resumes arbitrary sample boundaries exactly and ignores checkpoints after seeking", () => {
  const source = sine(4);
  const c = { ...clip(1.37), trimOut: 4000, duration: 2000 };
  const split = 48137;
  const [whole] = render(source, c, 0, split + 24000);
  const {
    channels: [a],
    continuation,
  } = renderResult(source, c, 0, split);
  const [b] = render(source, c, (split * 1000) / sr, 24000, continuation);
  expect(a).toEqual(whole!.subarray(0, split));
  expect(b).toEqual(whole!.subarray(split));
  const [seek] = render(source, c, 500, 10000, continuation);
  expect(seek).toEqual(render(source, c, 500, 10000)[0]);
});

it("selects the energetic channel inside the trim, ignoring loud discarded audio", () => {
  const left = new Float32Array(sr * 2).fill(10);
  left.fill(0, sr / 2, sr * 1.5);
  const right = sine(2);
  const req = {
    channels: [left, right],
    sourceSampleRate: sr,
    outputSampleRate: sr,
    clip: { ...clip(1.37), trimIn: 500, trimOut: 1500, duration: 700 },
    offsetMs: 0,
    outputSamples: sr * 0.7,
  };
  expect(renderClipAudio(req).channels[1]).toEqual(
    renderClipAudio({ ...req, channels: [right] }).channels[0],
  );
});

it("does not mutate shared checkpoints and returns a fresh checkpoint for sub-hop ranges", () => {
  const source = sine(4);
  const c = { ...clip(1.37), trimOut: 4000 };
  const first = renderResult(source, c, 0, 48137);
  const continuation = Object.freeze(first.continuation!);
  const a = renderResult(source, c, (48137 * 1000) / sr, 10, continuation);
  const b = renderResult(source, c, (48137 * 1000) / sr, 10, continuation);
  expect(a).toEqual(b);
  expect(a.continuation).not.toBe(continuation);
  expect(a.continuation!.nextStartSample).toBe(48147);
  expect(continuation.nextStartSample).toBe(48137);
});
