import { createEmptyProject, newId, renderClipAudio, type MediaClip } from "@movie-desk/core";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/audio/pitch-renderer", () => ({
  renderPitchInWorker: vi.fn(async (req) => renderClipAudio(req)),
}));
vi.mock("@/media/audio/audio-variant", () => ({ audioBlobFor: async () => new Blob(["fixture"]) }));
import { renderPitchInWorker } from "@/audio/pitch-renderer";
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
  expect(renderPitchInWorker).toHaveBeenCalledTimes(3);
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
