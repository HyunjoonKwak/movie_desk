import { afterEach, expect, it, vi } from "vitest";
import {
  createEmptyProject,
  newId,
  type ID,
  type MediaClip,
  type SequenceClip,
  type Project,
  type Timeline,
  renderClipAudio,
  sequenceAudioTime,
  sourceOffsetForRamp,
  routeStereo,
  resolveTrackRoute,
  buildAudioSequencePlan,
  MAX_SEQUENCE_DEPTH,
} from "@movie-desk/core";
vi.mock("@/media/audio/audio-variant", () => ({ audioBlobFor: async () => new Blob(["fixture"]) }));
vi.mock("@/audio/pitch-renderer", () => ({
  renderPitchRangeInWorker: vi.fn(async (req) => renderClipAudio(req)),
}));
import { renderPitchRangeInWorker } from "@/audio/pitch-renderer";
import { ProjectAudioMixer, resampleClipAudioRange } from "../audio-mixer";
import { playheadLevel } from "@/preview/playhead-level";

const sr = 48000;
const assetId = newId();
const asset = {
  id: assetId,
  name: "tone",
  kind: "audio" as const,
  mime: "audio/wav",
  importedAt: 0,
  durationMs: 4000,
  opfsPath: "fixture",
  waveformPeaks: [0.2, 0.2],
};
const source = [
  Float32Array.from({ length: sr * 4 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / sr) * 0.1),
  Float32Array.from({ length: sr * 4 }, (_, i) => Math.cos((2 * Math.PI * 660 * i) / sr) * 0.05),
];
const media = (patch: Partial<MediaClip> = {}): MediaClip => ({
  id: newId(),
  kind: "media",
  assetId,
  start: 0,
  duration: 1000,
  trimIn: 0,
  trimOut: 4000,
  speed: 1,
  effects: [],
  keyframes: [],
  ...patch,
});
const seq = (id: ID, patch: Partial<SequenceClip> = {}): SequenceClip => ({
  id: newId(),
  kind: "sequence",
  timelineId: id,
  start: 0,
  duration: 1000,
  trimIn: 0,
  trimOut: 4000,
  speed: 1,
  effects: [],
  keyframes: [],
  ...patch,
});
const fixture = (leaf = media()) => {
  const p = createEmptyProject();
  const child: Timeline = {
    ...p.timeline,
    id: newId(),
    duration: 4000,
    tracks: [{ ...p.timeline.tracks[0]!, clips: [leaf] }],
  };
  const parent = seq(child.id);
  const root = {
    ...p.timeline,
    duration: 1000,
    tracks: [{ ...p.timeline.tracks[0]!, clips: [parent] }],
  };
  return { ...p, timeline: root, timelines: [root, child], mediaLibrary: [asset] };
};
const mockDecode = () =>
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      async decodeAudioData() {
        return { sampleRate: sr, numberOfChannels: 2, getChannelData: (c: number) => source[c] };
      }
    },
  );
const mix = async (p: Project, chunkDurationMs = 137) => {
  mockDecode();
  const mixer = new ProjectAudioMixer(p, () => asset);
  const out = [
    new Float32Array(Math.ceil((p.timeline.duration * sr) / 1000)),
    new Float32Array(Math.ceil((p.timeline.duration * sr) / 1000)),
  ];
  try {
    for await (const chunk of mixer.chunks({ chunkDurationMs }))
      for (let c = 0; c < 2; c++) out[c]!.set(chunk.channels[c]!, chunk.startSample);
  } finally {
    mixer.dispose();
  }
  return out;
};
const maxDiff = (a: readonly Float32Array[], b: readonly Float32Array[]) => {
  let error = 0;
  for (let c = 0; c < a.length; c++)
    for (let i = 0; i < a[c]!.length; i++) error = Math.max(error, Math.abs(a[c]![i]! - b[c]![i]!));
  return error;
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("matches flat PCM sample by sample with parent trim, placement and clipping", async () => {
  const leaf = media({ start: 250, duration: 1200 });
  const p = fixture(leaf);
  const parent = seq(p.timelines[1]!.id, { start: 100, trimIn: 200, duration: 800 });
  const nested = {
    ...p,
    timeline: { ...p.timeline, tracks: [{ ...p.timeline.tracks[0]!, clips: [parent] }] },
  };
  const flat = {
    ...p,
    timeline: {
      ...p.timeline,
      tracks: [{ ...p.timeline.tracks[0]!, clips: [{ ...leaf, start: 150, duration: 750 }] }],
    },
  };
  expect(maxDiff(await mix(nested), await mix(flat))).toBeLessThan(1e-7);
});

it("uses Phase 4 timestamps and the same 10ms ramp grid across chunk boundaries", async () => {
  const p = fixture(media({ duration: 4000 }));
  const parent = seq(p.timelines[1]!.id, { start: 100, trimIn: 50, speed: 2 });
  expect(sequenceAudioTime(parent, 400)).toBe(650);
  const ramp = {
    ...parent,
    trimIn: 100,
    speed: 1,
    keyframes: [
      {
        target: "speed",
        keyframes: [
          { at: 0, value: 1, easing: "linear" as const },
          { at: 1000, value: 3, easing: "linear" as const },
        ],
      },
    ],
  };
  expect(sequenceAudioTime(ramp, 600)).toBe(845);
  const encoded = Float32Array.from({ length: sr * 4 }, (_, i) => i / sr / 10);
  for (const offset of [0, 137, 311]) {
    const pcm = resampleClipAudioRange(encoded, sr, sr, ramp, offset, 24000);
    for (let i = 0; i < pcm.length; i += 97) {
      const ms = ramp.trimIn + sourceOffsetForRamp(ramp, offset + (i * 1000) / sr);
      expect(pcm[i]).toBeCloseTo(ms / 10000, 6);
    }
  }
  const project = {
    ...p,
    timeline: {
      ...p.timeline,
      tracks: [{ ...p.timeline.tracks[0]!, clips: [{ ...ramp, start: 0 }] }],
    },
  };
  expect(maxDiff(await mix(project, 137), await mix(project, 1000))).toBeLessThan(1e-6);
});

it("folds child gain/pan/bus and envelope before parent pan/bus with master once", async () => {
  const p = fixture(
    media({
      volume: 0.1,
      keyframes: [{ target: "volume", keyframes: [{ at: 0, value: 0.4, easing: "linear" }] }],
    }),
  );
  const child = {
    ...p.timelines[1]!,
    tracks: [{ ...p.timelines[1]!.tracks[0]!, audio: { gainDb: 3, pan: -0.4, busId: "b" } }],
  };
  const parent = { ...p.timeline.tracks[0]!.clips[0]!, volume: 0.5 };
  const root = {
    ...p.timeline,
    tracks: [
      { ...p.timeline.tracks[0]!, audio: { gainDb: -2, pan: 0.7, busId: "b" }, clips: [parent] },
    ],
  };
  const project = {
    ...p,
    timeline: root,
    timelines: [root, child],
    audio: { buses: [{ id: "b", name: "B", gainDb: -3 }], master: { gainDb: 2 } },
  };
  const childPcm = routeStereo(
    source.map((c) => c.slice(0, sr).map((v) => v * 0.4)),
    resolveTrackRoute(project, child.tracks[0]!, child, false),
  );
  const expected = routeStereo(
    childPcm.map((c) => c.map((v) => v * 0.5)),
    resolveTrackRoute(project, root.tracks[0]!),
  );
  expect(maxDiff(await mix(project), expected)).toBeLessThan(1e-7);
});

it("honors parent mute, gain and local parent/child solo, including meters", async () => {
  const p = fixture();
  const track = p.timeline.tracks[0]!;
  const edit = (tracks: Project["timeline"]["tracks"]) => ({
    ...p,
    timeline: { ...p.timeline, tracks },
  });
  const baseline = await mix(p);
  expect(
    maxDiff(
      await mix(edit([{ ...track, audio: { gainDb: -6 } }])),
      baseline.map((c) => c.map((v) => v * 10 ** (-6 / 20))),
    ),
  ).toBeLessThan(1e-7);
  for (const project of [
    edit([{ ...track, muted: true }]),
    edit([track, { ...track, id: newId(), clips: [], solo: true }]),
    {
      ...p,
      timelines: [
        p.timeline,
        { ...p.timelines[1]!, tracks: [{ ...p.timelines[1]!.tracks[0]!, muted: true }] },
      ],
    },
  ]) {
    expect((await mix(project)).every((c) => c.every((v) => v === 0))).toBe(true);
    expect(playheadLevel(project, () => asset)).toBe(0);
  }
  expect(maxDiff(await mix(edit([{ ...track, solo: true }])), baseline)).toBe(0);
  expect(playheadLevel(p, () => asset)).toBe(0.2);
});

it.each(["cycle", "self", "missing", "depth"])(
  "silences %s with bounded completion",
  async (failure) => {
    const p = fixture();
    let timelines = [...p.timelines];
    if (failure === "missing") timelines = [p.timeline];
    if (failure === "self" || failure === "cycle") {
      const child = timelines[1]!;
      timelines[1] = {
        ...child,
        tracks: [
          {
            ...child.tracks[0]!,
            clips: [media(), seq(failure === "self" ? child.id : p.timeline.id)],
          },
        ],
      };
    }
    if (failure === "depth") {
      for (let i = 1; i < MAX_SEQUENCE_DEPTH; i++) {
        const last = timelines.at(-1)!;
        const next = { ...last, id: newId() };
        timelines[timelines.length - 1] = {
          ...last,
          tracks: [{ ...last.tracks[0]!, clips: [seq(next.id)] }],
        };
        timelines.push(next);
      }
    }
    const project = { ...p, timelines };
    expect(buildAudioSequencePlan(project).clips).toHaveLength(0);
    expect((await mix(project)).every((c) => c.every((v) => v === 0))).toBe(true);
    expect(playheadLevel(project, () => asset)).toBe(0);
  },
  2000,
);

it("applies child pitch preservation before parent varispeed, preserving transform order", async () => {
  const leaf = media({ speed: 2, preservePitch: true, duration: 2000 });
  const p = fixture(leaf);
  const parent = seq(p.timelines[1]!.id, { speed: 2, duration: 1000 });
  const project = {
    ...p,
    timeline: { ...p.timeline, tracks: [{ ...p.timeline.tracks[0]!, clips: [parent] }] },
  };
  const child = renderClipAudio({
    channels: source,
    sourceSampleRate: sr,
    outputSampleRate: sr,
    clip: leaf,
    offsetMs: 0,
    outputSamples: sr * 2,
  }).channels;
  const expected = child.map((c) => resampleClipAudioRange(c, sr, sr, parent, 0, sr));
  const actual = await mix(project, 1000);
  expect(renderPitchRangeInWorker).toHaveBeenCalled();
  expect(maxDiff(actual, await mix(project, 137))).toBeLessThan(1e-6);
  expect(maxDiff(actual, expected)).toBeLessThan(1e-6);
  // Zero-crossing frequency away from overlap boundaries: child 440Hz remains
  // preserved, then parent 2x varispeed produces 880Hz (not 440 or 1760Hz).
  let crossings = 0;
  for (let i = 4801; i < 43200; i++) if (actual[0]![i - 1]! <= 0 && actual[0]![i]! > 0) crossings++;
  expect(crossings / 0.8).toBe(880);
});

it("applies a shared project bus exactly once regardless of nesting", async () => {
  const p = fixture();
  const child = {
    ...p.timelines[1]!,
    tracks: [{ ...p.timelines[1]!.tracks[0]!, audio: { busId: "b" } }],
  };
  const root = { ...p.timeline, tracks: [{ ...p.timeline.tracks[0]!, audio: { busId: "b" } }] };
  const project = {
    ...p,
    timeline: root,
    timelines: [root, child],
    audio: { buses: [{ id: "b", name: "B", gainDb: 0 }], master: { gainDb: 0 } },
  };
  const before = await mix(project);
  const after = await mix({
    ...project,
    audio: { ...project.audio, buses: [{ id: "b", name: "B", gainDb: -6 }] },
  });
  expect(
    maxDiff(
      after,
      before.map((c) => c.map((v) => v * 10 ** (-6 / 20))),
    ),
  ).toBeLessThan(1e-7);
  // A child-only bus assignment neither attenuates nor mutes the folded source.
  const childOnly = {
    ...project,
    timeline: { ...root, tracks: [{ ...root.tracks[0]!, audio: {} }] },
    audio: { ...project.audio, buses: [{ id: "b", name: "B", gainDb: -6, muted: true }] },
  };
  expect(maxDiff(await mix(childOnly), before)).toBe(0);
});

it("supports repeated instances, independent trims, local solos and the maximum valid depth", async () => {
  const p = fixture(media({ duration: 4000 }));
  const child = p.timelines[1]!;
  const root = {
    ...p.timeline,
    tracks: [
      {
        ...p.timeline.tracks[0]!,
        clips: [seq(child.id, { trimIn: 100 }), seq(child.id, { trimIn: 400, volume: 0.5 })],
      },
    ],
  };
  const repeated = {
    ...p,
    timeline: root,
    timelines: [
      root,
      {
        ...child,
        tracks: [
          { ...child.tracks[0]!, solo: true },
          { ...child.tracks[0]!, id: newId(), muted: false, clips: [media({ volume: 10 })] },
        ],
      },
    ],
  };
  const flat = {
    ...p,
    timeline: {
      ...root,
      tracks: [
        {
          ...root.tracks[0]!,
          clips: [media({ trimIn: 100 }), media({ trimIn: 400, volume: 0.5 })],
        },
      ],
    },
  };
  expect(maxDiff(await mix(repeated), await mix(flat))).toBeLessThan(1e-7);
  const timelines = [...p.timelines];
  for (let i = timelines.length; i < MAX_SEQUENCE_DEPTH; i++) {
    const last = timelines.at(-1)!;
    const next = { ...last, id: newId() };
    timelines[timelines.length - 1] = {
      ...last,
      tracks: [{ ...last.tracks[0]!, clips: [seq(next.id)] }],
    };
    timelines.push(next);
  }
  expect(maxDiff(await mix({ ...p, timelines }), await mix(p))).toBeLessThan(1e-7);
});

it("retains unclipped child PCM until the root limiter", async () => {
  const p = fixture(media({ volume: 20 }));
  const parent = seq(p.timelines[1]!.id, { volume: 0.01 });
  const nested = {
    ...p,
    timeline: { ...p.timeline, tracks: [{ ...p.timeline.tracks[0]!, clips: [parent] }] },
  };
  const flat = {
    ...p,
    timeline: {
      ...p.timeline,
      tracks: [{ ...p.timeline.tracks[0]!, clips: [media({ volume: 0.2 })] }],
    },
  };
  expect(maxDiff(await mix(nested), await mix(flat))).toBeLessThan(1e-7);
});

it.skipIf(!process.env.B5_AUDIO_BENCHMARK)(
  "records alternating paired flat/nested export timings",
  async () => {
    const { writeFile } = await import("node:fs/promises");
    const p = fixture(media({ duration: 1000 }));
    const flat = {
      ...p,
      timeline: { ...p.timeline, tracks: [{ ...p.timeline.tracks[0]!, clips: [media()] }] },
    };
    const extra = { ...p.timelines[1]!, id: newId() };
    const nested2 = {
      ...p,
      timelines: [
        p.timeline,
        { ...p.timelines[1]!, tracks: [{ ...p.timelines[1]!.tracks[0]!, clips: [seq(extra.id)] }] },
        extra,
      ],
    };
    const evidence = [];
    const percentile = (values: number[], q: number) =>
      [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)]!;
    for (const [name, nested] of [
      ["one-level", p],
      ["two-level", nested2],
    ] as const) {
      for (let i = 0; i < 30; i++) {
        await mix(flat, 1000);
        await mix(nested, 1000);
      }
      const pairs = [];
      let maximumSampleError = 0;
      for (let i = 0; i < 300; i++) {
        const times: number[] = [];
        const results = [];
        for (const project of i % 2 ? [nested, flat] : [flat, nested]) {
          const start = performance.now();
          results.push(await mix(project, 1000));
          times.push(performance.now() - start);
        }
        maximumSampleError = Math.max(maximumSampleError, maxDiff(results[0]!, results[1]!));
        const [flatMs, nestedMs] = i % 2 ? [times[1]!, times[0]!] : [times[0]!, times[1]!];
        pairs.push({
          order: i % 2 ? "nested-flat" : "flat-nested",
          flatMs,
          nestedMs,
          ratio: nestedMs / flatMs,
        });
      }
      expect(maximumSampleError).toBeLessThan(1e-7);
      evidence.push({
        name,
        warmups: 30,
        measuredPairs: 300,
        durationMs: 1000,
        sampleRate: sr,
        maximumSampleError,
        flatP50Ms: percentile(
          pairs.map((p) => p.flatMs),
          0.5,
        ),
        nestedP50Ms: percentile(
          pairs.map((p) => p.nestedMs),
          0.5,
        ),
        nestedP95Ms: percentile(
          pairs.map((p) => p.nestedMs),
          0.95,
        ),
        medianPairedRatio: percentile(
          pairs.map((p) => p.ratio),
          0.5,
        ),
        pairs,
      });
    }
    await writeFile(
      process.env.B5_AUDIO_BENCHMARK!,
      JSON.stringify(
        {
          scope:
            "ProjectAudioMixer PCM export; synthetic decoded 48k stereo source; no codec, disk IO or Worker transfer",
          evidence,
        },
        null,
        2,
      ),
    );
  },
  60000,
);

it("maps fractional offsets, single speed keys and reverse using the picture integral", () => {
  const encoded = Float32Array.from({ length: sr * 4 }, (_, i) => i / sr / 10);
  const clips = [
    seq(newId(), { trimIn: 500, speed: -0.5 }),
    seq(newId(), {
      trimIn: 50,
      speed: 1.2,
      keyframes: [{ target: "speed", keyframes: [{ at: 0, value: 3, easing: "linear" }] }],
    }),
    seq(newId(), {
      trimIn: 50,
      keyframes: [
        {
          target: "speed",
          keyframes: [
            { at: 0, value: 0.4, easing: "linear" },
            { at: 1000, value: 2.7, easing: "linear" },
          ],
        },
      ],
    }),
  ];
  for (const clip of clips) {
    const offset = 137.0123;
    const pcm = resampleClipAudioRange(encoded, sr, sr, clip, offset, 17000);
    for (let i = 0; i < pcm.length; i += 43) {
      const ms = sequenceAudioTime(clip, clip.start + offset + (i * 1000) / sr);
      expect(pcm[i]).toBeCloseTo(ms / 10000, 6);
    }
  }
});

it("updates nested fallback strip meters after child-only edits without doubling root routing", async () => {
  const { estimatedLevels } = await import("@/mixer/estimated-levels");
  const p = fixture();
  const child = {
    ...p.timelines[1]!,
    tracks: [{ ...p.timelines[1]!.tracks[0]!, audio: { gainDb: -6 } }],
  };
  const root = {
    ...p.timeline,
    tracks: [{ ...p.timeline.tracks[0]!, audio: { gainDb: -6, busId: "b" } }],
  };
  const project = {
    ...p,
    timeline: root,
    timelines: [root, child],
    audio: { buses: [{ id: "b", name: "B", gainDb: -6 }], master: { gainDb: -6 } },
  };
  const waveforms = {};
  const first = estimatedLevels(project, waveforms);
  expect(first[`track:${root.tracks[0]!.id}`]).toBeCloseTo(0.2 * 10 ** (-12 / 20), 7);
  expect(first.master).toBeCloseTo(0.2 * 10 ** (-24 / 20), 7);
  const edited = {
    ...project,
    timelines: [root, { ...child, tracks: [{ ...child.tracks[0]!, muted: true }] }],
  };
  expect(estimatedLevels(edited, waveforms).master).toBe(0);
});

it("matches fallback master meters to real nested PCM for representable stereo peak envelopes", async () => {
  const { estimatedLevels } = await import("@/mixer/estimated-levels");
  const constant = new Float32Array(sr * 4).fill(0.2);
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      async decodeAudioData() {
        return { sampleRate: sr, numberOfChannels: 2, getChannelData: () => constant };
      }
    },
  );
  const p = fixture(
    media({
      volume: 0.9,
      keyframes: [{ target: "volume", keyframes: [{ at: 0, value: 0.3, easing: "linear" }] }],
    }),
  );
  const child = {
    ...p.timelines[1]!,
    tracks: [{ ...p.timelines[1]!.tracks[0]!, audio: { gainDb: -6, pan: -0.4, busId: "b" } }],
  };
  const root = {
    ...p.timeline,
    tracks: [
      {
        ...p.timeline.tracks[0]!,
        clips: [seq(child.id, { volume: 0.5 })],
        audio: { gainDb: -3, pan: 0.7, busId: "b" },
      },
    ],
  };
  const project = {
    ...p,
    timeline: root,
    timelines: [root, child],
    audio: { buses: [{ id: "b", name: "B", gainDb: -6 }], master: { gainDb: 2 } },
  };
  const mixer = new ProjectAudioMixer(project, () => asset);
  let measured = 0;
  try {
    for await (const chunk of mixer.chunks())
      for (const channel of chunk.channels)
        for (const value of channel) measured = Math.max(measured, Math.abs(value));
  } finally {
    mixer.dispose();
  }
  // Scalar envelopes can represent constant equal-channel positive PCM exactly;
  // two opposite pan stages ensure the source stays stereo until root routing.
  expect(Math.abs(estimatedLevels(project, {}).master! - measured)).toBeLessThan(1e-7);
  expect(Math.abs(playheadLevel(project, () => asset) - measured)).toBeLessThan(1e-7);
});
