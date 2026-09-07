import { TruePeakMeter } from "@movie-desk/core";
import { expect, it } from "vitest";
import { combineInlineStateful, type MixerWorkerResponse } from "../audio-mixer-worker";

it.each([1, 0.3, 4])(
  "measures exact encoder PCM across arbitrary chunks (gain %s)",
  (masterGain) => {
    const source = [0, 1].map((phase) =>
      Float32Array.from({ length: 5003 }, (_, i) => 1.3 * Math.sin(i * 1.7 + phase)),
    ) as [Float32Array, Float32Array];
    const expected = new TruePeakMeter(2);
    let state: MixerWorkerResponse["peakState"];
    let final: MixerWorkerResponse | undefined;
    let clipped = 0;
    let expectedClipped = 0;
    for (let start = 0; start < source[0].length; start += 997) {
      const voiceChannels = source.map((c) => c.slice(start, start + 997)) as typeof source;
      const raw = combineInlineStateful({
        voiceChannels,
        musicChannels: voiceChannels.map((c) => new Float32Array(c.length)) as typeof source,
        sampleRate: 48000,
      });
      const normalized = raw.channels.map((c) =>
        Float32Array.from(c, (value) => {
          const scaled = value * masterGain;
          expectedClipped += Number(Math.abs(scaled) > 1);
          return Math.max(-1, Math.min(1, scaled));
        }),
      );
      expected.push(normalized);
      const snapshot = state ? structuredClone(state) : undefined;
      final = combineInlineStateful({
        voiceChannels,
        musicChannels: voiceChannels.map((c) => new Float32Array(c.length)) as typeof source,
        sampleRate: 48000,
        encoder: {
          masterGain,
          final: start + 997 >= source[0].length,
          ...(state ? { peakState: state } : {}),
        },
      });
      expect(final.channels).toEqual(normalized);
      expect(state).toEqual(snapshot);
      state = final.peakState;
      clipped += final.audioPeaks!.clippedSamples;
    }
    expect(clipped).toBe(expectedClipped);
    expect(final!.audioPeaks).toEqual({
      ...expected.finish(),
      clippedSamples: final!.audioPeaks!.clippedSamples,
    });
  },
);
