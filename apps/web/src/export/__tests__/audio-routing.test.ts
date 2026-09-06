import { createEmptyProject, newId, dbToLinear, type MediaClip } from "@movie-desk/core";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/media/audio/audio-variant", () => ({ audioBlobFor: async () => new Blob(["fixture"]) }));
import { ProjectAudioMixer } from "../audio-mixer";
import { measureLoudness } from "../loudness";

afterEach(() => vi.unstubAllGlobals());
it.each([false, true])(
  "exports track, bus, master and volume replacement; bus mute=%s",
  async (muted) => {
    const channels = [
      Float32Array.from(
        { length: 48000 },
        (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000) * 0.2,
      ),
      new Float32Array(48000),
    ];
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        async decodeAudioData() {
          return {
            sampleRate: 48000,
            numberOfChannels: 2,
            getChannelData: (c: number) => channels[c],
          };
        }
      },
    );
    const p = createEmptyProject();
    const id = newId();
    const clip: MediaClip = {
      id: newId(),
      kind: "media",
      assetId: id,
      start: 0,
      duration: 1000,
      trimIn: 0,
      trimOut: 1000,
      speed: 1,
      volume: 0.1,
      effects: [],
      keyframes: [{ target: "volume", keyframes: [{ at: 0, value: 0.5, easing: "linear" }] }],
    };
    const track = {
      ...p.timeline.tracks[0]!,
      clips: [clip],
      audio: { gainDb: -6, pan: 1, busId: "bus" },
    };
    const project = {
      ...p,
      audio: { buses: [{ id: "bus", name: "Bus", gainDb: -3, muted }], master: { gainDb: 2 } },
      timeline: { ...p.timeline, duration: 1000, tracks: [track] },
    };
    const mixer = new ProjectAudioMixer(project, () => ({
      id,
      name: "tone",
      kind: "audio",
      mime: "audio/wav",
      importedAt: 0,
      durationMs: 1000,
      opfsPath: "fixture",
    }));
    const out = [new Float32Array(48000), new Float32Array(48000)];
    for await (const chunk of mixer.chunks({ chunkDurationMs: 137 }))
      for (let c = 0; c < 2; c++) out[c]!.set(chunk.channels[c]!, chunk.startSample);
    for (let i = 0; i < 48000; i++) {
      expect(out[0]![i]).toBeCloseTo(0, 7);
      expect(out[1]![i]).toBeCloseTo(muted ? 0 : channels[0]![i]! * 0.5 * dbToLinear(-7), 6);
    }
    if (!muted) {
      const before = measureLoudness(out).integratedLufs;
      const normalizationGain = dbToLinear(-20 - before);
      const normalized = out.map((channel) => channel.map((v) => v * normalizationGain));
      expect(measureLoudness(normalized).integratedLufs).toBeCloseTo(-20, 4);
    }
    mixer.dispose();
  },
);
