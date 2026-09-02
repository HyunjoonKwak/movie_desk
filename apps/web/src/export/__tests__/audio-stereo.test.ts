import { createEmptyProject } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { ProjectAudioMixer, decodedStereoChannels, packStereoPlanar } from "../audio-mixer";
import { combineInline, combineInlineStateful } from "../audio-mixer-worker";

describe("stereo audio mixing", () => {
  it("keeps left and right buses independent", () => {
    const channels = combineInline({
      voiceChannels: [Float32Array.of(0.2, 0), Float32Array.of(0, 0.4)],
      musicChannels: [Float32Array.of(0.1, 0), Float32Array.of(0, 0.2)],
      sampleRate: 48_000,
    });

    expect([...channels[0]]).toEqual([expect.closeTo(0.3), 0]);
    expect([...channels[1]]).toEqual([0, expect.closeTo(0.6)]);
  });

  it("duplicates mono sources but preserves decoded stereo sources", () => {
    const left = Float32Array.of(1, 2);
    const right = Float32Array.of(3, 4);
    const mono = decodedStereoChannels({
      numberOfChannels: 1,
      getChannelData: () => left,
    });
    const stereo = decodedStereoChannels({
      numberOfChannels: 2,
      getChannelData: (channel) => (channel === 0 ? left : right),
    });

    expect(mono).toEqual([left, left]);
    expect(stereo).toEqual([left, right]);
  });

  it("uses one limiter gain for both channels", () => {
    const channels = combineInline({
      voiceChannels: [Float32Array.of(2), Float32Array.of(0.5)],
      musicChannels: [Float32Array.of(0), Float32Array.of(0)],
      sampleRate: 48_000,
    });

    expect([...channels[0]]).toEqual([1]);
    expect([...channels[1]]).toEqual([0.25]);
  });

  it("limits each stereo sample independently of surrounding chunk peaks", () => {
    const channels = combineInline({
      voiceChannels: [Float32Array.of(2, 0.5), Float32Array.of(0.5, 0.25)],
      musicChannels: [new Float32Array(2), new Float32Array(2)],
      sampleRate: 48_000,
    });

    expect([...channels[0]]).toEqual([1, 0.5]);
    expect([...channels[1]]).toEqual([0.25, 0.25]);
  });

  it("keeps ducking continuous and chunk-boundary invariant", () => {
    const request = {
      voiceChannels: [
        Float32Array.of(0, 1, 1, 0),
        Float32Array.of(0, 1, 1, 0),
      ] as [Float32Array, Float32Array],
      musicChannels: [
        Float32Array.of(1, 1, 1, 1),
        Float32Array.of(1, 1, 1, 1),
      ] as [Float32Array, Float32Array],
      sampleRate: 48_000,
      ducking: { enabled: true, amountDb: -12, thresholdDb: -20 },
    };
    const whole = combineInlineStateful(request);
    const first = combineInlineStateful({
      ...request,
      voiceChannels: request.voiceChannels.map((channel) => channel.slice(0, 2)) as [
        Float32Array,
        Float32Array,
      ],
      musicChannels: request.musicChannels.map((channel) => channel.slice(0, 2)) as [
        Float32Array,
        Float32Array,
      ],
    });
    const second = combineInlineStateful({
      ...request,
      voiceChannels: request.voiceChannels.map((channel) => channel.slice(2)) as [
        Float32Array,
        Float32Array,
      ],
      musicChannels: request.musicChannels.map((channel) => channel.slice(2)) as [
        Float32Array,
        Float32Array,
      ],
      initialDuckGain: first.finalDuckGain,
    });

    expect([...first.channels[0], ...second.channels[0]]).toEqual([...whole.channels[0]]);
    expect([...first.channels[1], ...second.channels[1]]).toEqual([...whole.channels[1]]);
  });

  it("packs planar encoder input as all left frames followed by all right frames", () => {
    const channels: [Float32Array, Float32Array] = [
      Float32Array.of(1, 2, 3),
      Float32Array.of(4, 5, 6),
    ];

    expect([...packStereoPlanar(channels, 1, 2)]).toEqual([2, 3, 5, 6]);
  });

  it("streams long timelines in bounded chunks", async () => {
    const base = createEmptyProject();
    const project = { ...base, timeline: { ...base.timeline, duration: 3100 } };
    const mixer = new ProjectAudioMixer(project, () => undefined);
    const chunks = [];
    for await (const chunk of mixer.chunks({ chunkDurationMs: 1000 })) chunks.push(chunk);

    expect(chunks.map((chunk) => chunk.channels[0].length)).toEqual([48_000, 48_000, 48_000, 4800]);
    expect(chunks.map((chunk) => chunk.startSample)).toEqual([0, 48_000, 96_000, 144_000]);
    mixer.dispose();
  });
});
