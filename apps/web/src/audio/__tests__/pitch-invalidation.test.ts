import { createEmptyProject, newId, type MediaAsset, type MediaClip } from "@movie-desk/core";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/media/audio/audio-variant", () => ({ audioBlobFor: async () => new Blob(["fixture"]) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("a late pre-relink decode cannot overwrite or replay the replacement asset", async () => {
  const pending: ((buffer: AudioBuffer) => void)[] = [];
  const started: AudioBuffer[] = [];
  // Meter publication is unrelated to decode/job invalidation in this Node test.
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "AudioContext",
    class {
      currentTime = 0;
      destination = {};
      async resume() {}
      decodeAudioData() {
        return new Promise<AudioBuffer>((resolve) => pending.push(resolve));
      }
      createGain() {
        return { gain: { value: 1 }, connect() {}, disconnect() {} };
      }
      createStereoPanner() {
        return { pan: { value: 0 }, connect() {}, disconnect() {} };
      }
      createBufferSource() {
        return {
          buffer: null as AudioBuffer | null,
          playbackRate: { value: 1 },
          connect(gain: unknown) {
            return gain;
          },
          disconnect() {},
          stop() {},
          start() {
            started.push(this.buffer!);
          },
          onended: null,
        };
      }
    },
  );
  const { getAudioEngine } = await import("@/preview/audio-engine");
  const engine = getAudioEngine();
  const asset: MediaAsset = {
    id: newId(),
    name: "same.wav",
    kind: "audio",
    mime: "audio/wav",
    opfsPath: "same-key",
    durationMs: 1000,
    importedAt: 0,
  };
  const clip: MediaClip = {
    id: newId(),
    assetId: asset.id,
    kind: "media",
    start: 0,
    duration: 1000,
    trimIn: 0,
    trimOut: 1000,
    speed: 1,
    effects: [],
    keyframes: [],
  };
  const base = createEmptyProject();
  const project = {
    ...base,
    mediaLibrary: [asset],
    timeline: {
      ...base.timeline,
      duration: 1000,
      tracks: base.timeline.tracks.map((t, i) => (i === 0 ? { ...t, clips: [clip] } : t)),
    },
  };
  const oldBuffer = { sampleRate: 48000 } as AudioBuffer;
  const newBuffer = { sampleRate: 48000 } as AudioBuffer;
  const first = engine.play(project, 0, 1);
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  engine.forget(asset.id);
  const replacement = engine.play(project, 0, 1);
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1]!(newBuffer);
  await replacement;
  pending[0]!(oldBuffer);
  await first;
  await engine.play(project, 0, 1);
  expect(pending).toHaveLength(2);
  expect(started).toEqual([newBuffer, newBuffer]);
  engine.stop();
});
