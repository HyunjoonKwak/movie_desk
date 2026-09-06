import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProject, newId, type MediaClip } from "@movie-desk/core";
const pending = vi.hoisted(
  () => [] as { signal: AbortSignal; resolve: (channels: Float32Array[]) => void }[],
);
vi.mock("@/audio/pitch-renderer", async (original) => ({
  ...(await original<typeof import("../pitch-renderer")>()),
  renderPitchInWorker: vi.fn(
    (_req, signal: AbortSignal) =>
      new Promise<Float32Array[]>((resolve) => pending.push({ signal, resolve })),
  ),
}));
vi.mock("@/media/audio/audio-variant", () => ({ audioBlobFor: async () => new Blob(["fixture"]) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  pending.length = 0;
});
it("speed edits abort stale jobs, immediately render the new key and only cache current audio", async () => {
  const started: unknown[] = [];
  const buffer = {
    sampleRate: 48000,
    length: 48000 * 600, // a short clip from a ten-minute source must be admitted
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(48000),
  };
  vi.stubGlobal(
    "AudioContext",
    class {
      currentTime = 0;
      destination = {};
      async resume() {}
      async decodeAudioData() {
        return buffer;
      }
      createBuffer() {
        return { ...buffer, copyToChannel() {} };
      }
      createGain() {
        return {
          gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} },
          connect() {},
          disconnect() {},
        };
      }
      createBufferSource() {
        return {
          buffer: null,
          playbackRate: { value: 1 },
          connect(g: unknown) {
            return g;
          },
          start() {
            started.push(this.buffer);
          },
          stop() {},
          disconnect() {},
          onended: null,
        };
      }
    },
  );
  const { useProjectStore } = await import("@/stores/project-store");
  const { getAudioEngine } = await import("@/preview/audio-engine");
  const { usePitchState } = await import("../pitch-state");
  const base = createEmptyProject();
  const asset = {
    id: newId(),
    kind: "audio" as const,
    name: "tone",
    mime: "audio/wav",
    opfsPath: "fixture",
    durationMs: 1000,
    importedAt: 0,
  };
  const clip: MediaClip = {
    id: newId(),
    assetId: asset.id,
    kind: "media",
    speed: 1,
    preservePitch: true,
    start: 0,
    duration: 1000,
    trimIn: 0,
    trimOut: 1000,
    effects: [],
    keyframes: [],
  };
  const project = {
    ...base,
    mediaLibrary: [asset],
    timeline: {
      ...base.timeline,
      duration: 1000,
      tracks: base.timeline.tracks.map((t, i) => (i === 0 ? { ...t, clips: [clip] } : t)),
    },
  };
  useProjectStore.setState({ project });
  const engine = getAudioEngine();
  await engine.play(project, 0, 1);
  expect(pending).toHaveLength(1);
  const updated = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((t, i) =>
        i === 0 ? { ...t, clips: [{ ...clip, speed: 2 }] } : t,
      ),
    },
  };
  useProjectStore.setState({ project: updated });
  await engine.play(updated, 0, 1);
  expect(pending[0]!.signal.aborted).toBe(true);
  expect(pending).toHaveLength(2);
  pending[0]!.resolve([new Float32Array(48000)]);
  await new Promise((r) => setTimeout(r, 10));
  expect(usePitchState.getState().entries[clip.id]?.state).toBe("rendering");
  pending[1]!.resolve([new Float32Array(48000)]);
  await vi.waitFor(() => expect(usePitchState.getState().entries[clip.id]?.state).toBe("ready"));
  expect(started.length).toBeGreaterThan(2); // completion reschedules immediately
  engine.stop();
  useProjectStore.setState({ project });
  await engine.play(project, 0, 1);
  expect(pending).toHaveLength(3); // old result never entered cache
  engine.stop();
});
