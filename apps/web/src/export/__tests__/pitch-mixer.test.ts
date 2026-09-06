import { createEmptyProject, newId, renderClipAudio, type MediaClip } from "@movie-desk/core";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/audio/pitch-renderer", () => ({
  renderPitchRangeInWorker: vi.fn(async (req) => renderClipAudio(req)),
}));
vi.mock("@/media/audio/audio-variant", () => ({ audioBlobFor: async () => new Blob(["fixture"]) }));
import { renderPitchRangeInWorker } from "@/audio/pitch-renderer";
import { ProjectAudioMixer, resampleClipAudioRange } from "../audio-mixer";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("exports trimmed ramp audio through the common DSP and preserves chunk lengths", async () => {
  const source = Float32Array.from({ length: 48000 * 4 }, (_, i) =>
    Math.sin((2 * Math.PI * 440 * i) / 48000),
  );
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      async decodeAudioData() {
        return { sampleRate: 48000, numberOfChannels: 2, getChannelData: () => source };
      }
    },
  );
  const assetId = newId();
  const clip: MediaClip = {
    id: newId(),
    assetId,
    kind: "media",
    start: 0,
    duration: 2000,
    trimIn: 500,
    trimOut: 3000,
    speed: 1,
    preservePitch: true,
    effects: [],
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
  const p = createEmptyProject();
  const project = {
    ...p,
    timeline: {
      ...p.timeline,
      duration: 2000,
      tracks: p.timeline.tracks.map((t, i) => (i === 0 ? { ...t, clips: [clip] } : t)),
    },
  };
  const mixer = new ProjectAudioMixer(project, () => ({
    id: assetId,
    kind: "audio",
    name: "fixture",
    mime: "audio/wav",
    opfsPath: "fixture",
    durationMs: 4000,
    importedAt: 0,
  }));
  const chunks = [];
  for await (const chunk of mixer.chunks({ chunkDurationMs: 700 })) chunks.push(chunk);
  expect(chunks.map((c) => c.channels[0].length)).toEqual([33600, 33600, 28800]);
  expect(renderPitchRangeInWorker).toHaveBeenCalledTimes(3);
  expect(chunks.every((c) => c.channels[0].some((v) => Math.abs(v) > 0.1))).toBe(true);
  mixer.dispose();
});
it("keeps reverse fallback and interpolates fractional source samples", () => {
  const c: MediaClip = {
    id: newId(),
    assetId: newId(),
    kind: "media",
    start: 0,
    duration: 4,
    trimIn: 4,
    trimOut: 8,
    speed: -0.5,
    preservePitch: true,
    effects: [],
    keyframes: [],
  };
  expect([
    ...resampleClipAudioRange(Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]), 1000, 1000, c, 0, 4),
  ]).toEqual([4, 3.5, 3, 2.5]);
});

it.each(["worker unavailable", "worker failed", "worker timed out"])(
  "exports varispeed and records a notice on %s",
  async (message) => {
    vi.mocked(renderPitchRangeInWorker).mockRejectedValueOnce(new Error(message));
    const source = new Float32Array(4800).fill(0.25);
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        async decodeAudioData() {
          return { sampleRate: 48000, numberOfChannels: 1, getChannelData: () => source };
        }
      },
    );
    const p = createEmptyProject();
    const assetId = newId();
    const clip: MediaClip = {
      id: newId(),
      assetId,
      kind: "media",
      start: 0,
      duration: 100,
      trimIn: 0,
      trimOut: 100,
      speed: 1,
      preservePitch: true,
      effects: [],
      keyframes: [],
    };
    const project = {
      ...p,
      timeline: {
        ...p.timeline,
        duration: 100,
        tracks: p.timeline.tracks.map((t, i) => (i === 0 ? { ...t, clips: [clip] } : t)),
      },
    };
    const mixer = new ProjectAudioMixer(project, () => ({
      id: assetId,
      kind: "audio",
      name: "tone",
      mime: "audio/wav",
      opfsPath: "fixture",
      durationMs: 1000,
      importedAt: 0,
    }));
    const chunks = [];
    for await (const chunk of mixer.chunks({ chunkDurationMs: 50 })) chunks.push(chunk);
    expect(mixer.pitchFallback).toBe(true);
    expect(renderPitchRangeInWorker).toHaveBeenCalledOnce();
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.channels[0][100]).toBeCloseTo(0.25);
    expect(chunks[0]!.channels[1]).toEqual(chunks[0]!.channels[0]);
  },
);

it.each([0.5, 1.37, 2])(
  "keeps padded audio-gain export continuous at 30s (%sx)",
  async (speed) => {
    const sr = 48000;
    const source = Float32Array.from(
      { length: sr * 62 },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 443 * i) / sr),
    );
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        async decodeAudioData() {
          return { sampleRate: sr, numberOfChannels: 1, getChannelData: () => source };
        }
      },
    );
    const p = createEmptyProject();
    const assetId = newId();
    const clip: MediaClip = {
      id: newId(),
      assetId,
      kind: "media",
      start: 0,
      duration: 31000,
      trimIn: 0,
      trimOut: 62000,
      speed,
      preservePitch: true,
      effects: [{ id: newId(), type: "audio-gain", enabled: true, params: { db: -3 } }],
      keyframes: [],
    };
    const project = {
      ...p,
      timeline: {
        ...p.timeline,
        duration: clip.duration,
        tracks: p.timeline.tracks.map((t, i) => (i === 0 ? { ...t, clips: [clip] } : t)),
      },
    };
    const mixer = new ProjectAudioMixer(project, () => ({
      id: assetId,
      kind: "audio",
      name: "gain tone",
      mime: "audio/wav",
      opfsPath: "fixture",
      durationMs: 62000,
      importedAt: 0,
    }));
    const chunks = [];
    for await (const chunk of mixer.chunks()) chunks.push(chunk);
    const jump = Math.abs(chunks[1]!.channels[0][0]! - chunks[0]!.channels[0].at(-1)!);
    expect(jump).toBeLessThan(0.05);
    const calls = vi.mocked(renderPitchRangeInWorker).mock.calls;
    expect(calls[1]![0].continuation!.nextStartSample).toBe(
      Math.round((calls[1]![0].offsetMs * sr) / 1000),
    );
    // Each chunks() generator starts with its own state, even on a reused mixer.
    const repeat = [];
    for await (const chunk of mixer.chunks()) repeat.push(chunk);
    expect(repeat[1]!.channels[0]).toEqual(chunks[1]!.channels[0]);
    mixer.dispose();
  },
  20000,
);
