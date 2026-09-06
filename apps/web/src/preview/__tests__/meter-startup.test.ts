import { createEmptyProject, newId } from "@movie-desk/core";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn<() => Promise<boolean>>(),
  graphs: [] as { enableMetering: ReturnType<typeof vi.fn> }[],
}));
vi.mock("@/mixer/audio-graph", () => ({
  loadMeterWorklet: mocks.load,
  MixerAudioGraph: class {
    enableMetering = vi.fn();
    constructor() {
      mocks.graphs.push(this);
    }
    update() {}
    dispose() {}
    input() {
      return {};
    }
  },
}));
vi.mock("@/media/audio/audio-variant", () => ({ audioBlobFor: async () => new Blob(["fixture"]) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
  mocks.graphs.length = 0;
  mocks.load.mockReset();
});

it.each([false, true])(
  "schedules before a 300ms worklet load and guards stopped playback (%s)",
  async (stop) => {
    vi.useFakeTimers();
    let ready!: (available: boolean) => void;
    mocks.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    const start = vi.fn();
    const sourceStop = vi.fn();
    const node = () => ({
      gain: { value: 1 },
      connect(target: unknown) {
        return target;
      },
      disconnect() {},
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        currentTime = 0;
        destination = {};
        async resume() {}
        async decodeAudioData() {
          return { sampleRate: 48000 };
        }
        createGain = node;
        createBufferSource() {
          return { ...node(), playbackRate: { value: 1 }, start, stop: sourceStop };
        }
      },
    );
    const { getAudioEngine } = await import("../audio-engine");
    const { useProjectStore } = await import("@/stores/project-store");
    const base = createEmptyProject();
    const assetId = newId();
    const project = {
      ...base,
      mediaLibrary: [
        {
          id: assetId,
          kind: "audio" as const,
          name: "tone",
          mime: "audio/wav",
          opfsPath: "fixture",
          importedAt: 0,
          durationMs: 1000,
        },
      ],
      timeline: {
        ...base.timeline,
        duration: 1000,
        tracks: [
          {
            ...base.timeline.tracks[0]!,
            clips: [
              {
                id: newId(),
                kind: "media" as const,
                assetId,
                start: 0,
                duration: 1000,
                trimIn: 0,
                trimOut: 1000,
                speed: 1,
                effects: [],
                keyframes: [],
              },
            ],
          },
        ],
      },
    };
    useProjectStore.setState({ project });
    const engine = getAudioEngine();
    const playing = engine.play(project, 0, 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.graphs[0]!.enableMetering).not.toHaveBeenCalled();
    if (stop) engine.stop();
    await vi.advanceTimersByTimeAsync(300);
    ready(true);
    await playing;
    await Promise.resolve();
    expect(mocks.graphs[0]!.enableMetering).toHaveBeenCalledTimes(stop ? 0 : 1);
    expect(start).toHaveBeenCalledOnce();
    expect(sourceStop).toHaveBeenCalledTimes(stop ? 1 : 0);
    engine.stop();
  },
);
