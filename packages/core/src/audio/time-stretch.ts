import type { MediaClip } from "../model/clip";
import { sampleKeyframeTrack } from "../timeline/keyframes";
import { sourceOffsetForRamp } from "../timeline/speed";

export const pitchRateSupported = (rate: number): boolean => rate >= 0.25 && rate <= 4;

export const pitchHasUnsupportedRange = (clip: MediaClip): boolean => {
  const ramp = clip.keyframes.find(
    (track) => track.target === "speed" && track.keyframes.length >= 2,
  );
  return ramp
    ? ramp.keyframes.some((key) => !pitchRateSupported(key.value))
    : !pitchRateSupported(clip.speed);
};

// A bounded checkpoint resumes overlap alignment across adjacent output ranges.
// Callers must scope it to one source and unchanged clip/rate configuration.
export interface StretchContinuation {
  nextStartSample?: number;
  firstHop?: number;
  cursor?: number;
  previous?: number;
  previousPreserved?: boolean;
  reference?: number;
}

export interface StretchRequest {
  continuation?: StretchContinuation;
  channels: Float32Array[];
  sourceSampleRate: number;
  sourceStartSample?: number;
  outputSampleRate: number;
  clip: MediaClip;
  offsetMs: number;
  outputSamples: number;
}

// Pure worker-side DSP. All channels share the alignment selected on channel 0
// (or the highest-energy channel), preserving stereo phase relationships.
// 20ms windows / 10ms hops, bounded ±5ms search: O(output samples).
export const renderClipAudio = (req: StretchRequest): Float32Array[] => {
  const { channels, sourceSampleRate: srcRate, outputSampleRate: sr, clip } = req;
  const length = Math.max(0, Math.floor(req.outputSamples));
  const output = channels.map(() => new Float32Array(length));
  if (!length || !channels.length) return output;
  const ratio = srcRate / sr;
  const hop = Math.max(1, Math.round(sr * 0.01));
  const window = hop * 2;
  const search = Math.round(sr * 0.005);
  const track = clip.keyframes.find((t) => t.target === "speed" && t.keyframes.length >= 2);
  const rateAt = (ms: number) =>
    track ? Math.max(0.05, sampleKeyframeTrack(track, ms) ?? clip.speed) : clip.speed;
  const sourceStart = req.sourceStartSample ?? 0;
  const lower = Math.max(0, (clip.trimIn * srcRate) / 1000);
  const upper = Math.min(sourceStart + channels[0]!.length, (clip.trimOut * srcRate) / 1000);
  const sample = (channel: Float32Array, position: number): number => {
    if (position < lower || position >= upper) return 0;
    const i = Math.floor(position) - sourceStart;
    const raw = channel[i] ?? 0;
    const a = Number.isFinite(raw) ? raw : 0;
    const next = channel[i + 1] ?? 0;
    const b = Number.isFinite(next) ? next : 0;
    return a + ((i + 1 + sourceStart < upper ? b : a) - a) * (position - sourceStart - i);
  };
  // Align ranges to the same hop grid; bounded pre-roll settles overlap search.
  const startSample = Math.round((req.offsetMs * sr) / 1000);
  const resume = req.continuation?.nextStartSample === startSample ? req.continuation : undefined;
  const firstHop = resume?.firstHop ?? Math.max(0, Math.floor(startSample / hop) - 4) * hop;
  let cursor =
    resume?.cursor ?? lower + (sourceOffsetForRamp(clip, (firstHop * 1000) / sr) * srcRate) / 1000;
  let previous = resume?.previous ?? cursor;
  let previousPreserved = resume?.previousPreserved ?? false;
  const weights = new Float32Array(length);
  let reference = 0;
  let maxEnergy = -1;
  for (let c = 0; c < channels.length; c++) {
    let energy = 0;
    for (
      let i = Math.max(0, Math.ceil(lower - sourceStart));
      i < Math.min(channels[c]!.length, upper - sourceStart);
      i += 256
    ) {
      const value = channels[c]![i]!;
      if (Number.isFinite(value)) energy += value * value;
    }
    if (energy > maxEnergy) {
      maxEnergy = energy;
      reference = c;
    }
  }
  reference = resume?.reference ?? reference;
  const checkpointHop = Math.max(0, Math.floor((startSample + length) / hop) - 1) * hop;
  for (let at = firstHop; at < startSample + length; at += hop) {
    if (at === checkpointHop && req.continuation) {
      Object.assign(req.continuation, {
        nextStartSample: startSample + length,
        firstHop: at,
        cursor,
        previous,
        previousPreserved,
        reference,
      });
    }
    const time = (at * 1000) / sr;
    const rate = rateAt(time);
    const preserve = clip.preservePitch === true && clip.speed > 0 && pitchRateSupported(rate);
    let anchor = cursor;
    if (preserve && previousPreserved) {
      const ref = channels[reference]!;
      let best = Number.NEGATIVE_INFINITY;
      let bestDelta = 0;
      // Cache dense overlap samples once: striding correlation aliases high tones.
      const tail = new Float32Array(hop);
      const candidates = new Float32Array(hop + 2 * search + 8);
      let aa = 0;
      for (let j = 0; j < hop; j++) {
        const a = sample(ref, previous + (hop + j) * ratio);
        tail[j] = a;
        aa += a * a;
      }
      for (let j = 0; j < candidates.length; j++)
        candidates[j] = sample(ref, cursor + (j - search - 4) * ratio);
      const score = (delta: number) => {
        let dot = 0;
        let bb = 0;
        for (let j = 0; j < hop; j++) {
          const a = tail[j]!;
          const b = candidates[delta + j + search + 4]!;
          dot += a * b;
          bb += b * b;
        }
        // Prefer the expected anchor in silence and on ties.
        return dot / Math.sqrt(aa * bb + 1e-20) - Math.abs(delta) * 1e-7;
      };
      for (let delta = -search; delta <= search; delta += 4) {
        const value = score(delta);
        if (value > best) {
          best = value;
          bestDelta = delta;
        }
      }
      const coarse = bestDelta;
      for (let delta = coarse - 3; delta <= coarse + 3; delta++) {
        const value = score(delta);
        if (value > best) {
          best = value;
          bestDelta = delta;
        }
      }
      anchor += bestDelta * ratio;
    }
    for (let j = 0; j < window; j++) {
      const index = at + j - startSample;
      if (index < 0 || index >= length) continue;
      const weight = j < hop ? (j + 1) / hop : (window - j - 1) / hop;
      const position = anchor + j * ratio * (preserve ? 1 : rate);
      weights[index]! += weight;
      for (let c = 0; c < output.length; c++)
        output[c]![index]! += sample(channels[c]!, position) * weight;
    }
    previous = anchor;
    previousPreserved = preserve;
    // The timeline mapping uses the core's left-endpoint 10ms integral.
    cursor += rate * hop * ratio;
  }
  for (const channel of output)
    for (let i = 0; i < length; i++) {
      const weight = weights[i] ?? 0;
      if (weight > 0) channel[i]! /= weight;
    }
  return output;
};
