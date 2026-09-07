import { afterEach, expect, it, vi } from "vitest";
import {
  createEmptyProject,
  newId,
  type MediaClip,
  type Project,
  type SequenceClip,
} from "@movie-desk/core";
const state = vi.hoisted(() => ({ project: null as unknown as Project, inputs: [] as string[] }));
vi.mock("@/stores/project-store", () => ({ useProjectStore: { getState: () => state } }));
vi.mock("@/media/audio/audio-variant", () => ({ audioBlobFor: async () => new Blob(["fixture"]) }));
vi.mock("@/mixer/audio-graph", () => ({
  loadMeterWorklet: async () => false,
  MixerAudioGraph: class {
    update() {}
    dispose() {}
    input(id: string) {
      state.inputs.push(id);
      return {};
    }
  },
}));
import { getAudioEngine } from "../audio-engine";

class Buffer {
  readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(c: number) {
    return this.data[c]!;
  }
  copyToChannel(data: Float32Array, c: number) {
    this.data[c]!.set(data);
  }
}
const sources: {
  buffer: Buffer | null;
  playbackRate: { value: number };
  start: ReturnType<typeof vi.fn>;
}[] = [];
class Context {
  currentTime = 0;
  destination = {};
  async resume() {}
  async decodeAudioData() {
    const b = new Buffer(2, 48000, 48000);
    b.data[0]!.fill(0.2);
    b.data[1]!.fill(0.1);
    return b;
  }
  createBuffer(c: number, n: number, sr: number) {
    return new Buffer(c, n, sr);
  }
  createGain() {
    return {
      gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect(node: unknown) {
        return node;
      },
      disconnect() {},
    };
  }
  createBufferSource() {
    const source = {
      buffer: null as Buffer | null,
      playbackRate: { value: 1 },
      start: vi.fn(),
      stop() {},
      connect(node: unknown) {
        return node;
      },
      disconnect() {},
      onended: null,
    };
    sources.push(source);
    return source;
  }
}
afterEach(() => {
  getAudioEngine().stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sources.length = 0;
  state.inputs.length = 0;
});
const makeFixture = () => {
  const p = createEmptyProject();
  const assetId = newId();
  const media: MediaClip = {
    id: newId(),
    kind: "media",
    assetId,
    start: 0,
    duration: 1000,
    trimIn: 0,
    trimOut: 1000,
    speed: 1,
    volume: 0.5,
    effects: [],
    keyframes: [],
  };
  const child = {
    ...p.timeline,
    id: newId(),
    duration: 1000,
    tracks: [
      { ...p.timeline.tracks[0]!, id: newId(), clips: [media], audio: { gainDb: -6, pan: 0 } },
    ],
  };
  const clip: SequenceClip = {
    id: newId(),
    kind: "sequence",
    timelineId: child.id,
    start: 0,
    duration: 500,
    trimIn: 0,
    trimOut: 1000,
    speed: 2,
    volume: 0.4,
    effects: [],
    keyframes: [],
  };
  const root = {
    ...p.timeline,
    duration: 500,
    tracks: [{ ...p.timeline.tracks[0]!, clips: [clip], audio: { gainDb: -3, pan: 0.6 } }],
  };
  state.project = {
    ...p,
    timeline: root,
    timelines: [root, child],
    mediaLibrary: [
      {
        id: assetId,
        kind: "audio",
        name: "tone",
        mime: "audio/wav",
        importedAt: 0,
        durationMs: 1000,
        opfsPath: "fixture",
      },
    ],
  };
  return root;
};
it("schedules folded stereo into the parent live graph without reapplying clip speed/volume", async () => {
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("OfflineAudioContext", Context);
  vi.spyOn(performance, "now").mockReturnValue(0);
  const root = makeFixture();
  await getAudioEngine().play(state.project, 0, 1);
  expect(sources).toHaveLength(1);
  expect(state.inputs).toEqual([root.tracks[0]!.id]);
  expect(sources[0]!.playbackRate.value).toBe(1);
  expect(sources[0]!.buffer!.length).toBe(24000);
  expect(sources[0]!.buffer!.data[0]![1000]).toBeCloseTo(0.2 * 0.5 * 10 ** (-6 / 20) * 0.4, 7);
  expect(sources[0]!.buffer!.data[1]![1000]).toBeCloseTo(0.1 * 0.5 * 10 ** (-6 / 20) * 0.4, 7);
  expect(sources[0]!.start).toHaveBeenCalledWith(0.03, 0, 0.5);
});

it("superseded nested playback cannot reject into the hook and stop the replacement", async () => {
  vi.stubGlobal("AudioContext", Context);
  vi.spyOn(performance, "now").mockReturnValue(0);
  makeFixture();
  let announce!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstDecode = true;
  vi.stubGlobal(
    "OfflineAudioContext",
    class extends Context {
      override async decodeAudioData() {
        if (firstDecode) {
          firstDecode = false;
          announce();
          await pending;
        }
        return super.decodeAudioData();
      }
    },
  );
  const engine = getAudioEngine();
  const failed = vi.fn(() => engine.stop());
  const previous = engine.play(state.project, 0, 1).catch(failed);
  await started;
  await engine.play(state.project, 0, 1);
  release();
  await previous;
  expect(failed).not.toHaveBeenCalled();
  expect(engine.isTransportDrifted(10000, 1)).toBe(true);
  expect(sources).toHaveLength(1);
});

it("propagates a current-generation nested scheduling failure", async () => {
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("OfflineAudioContext", Context);
  vi.spyOn(performance, "now").mockReturnValue(0);
  makeFixture();
  const failure = new Error("fixture output allocation failed");
  vi.spyOn(Context.prototype, "createBuffer").mockImplementationOnce(() => {
    throw failure;
  });
  await expect(getAudioEngine().play(state.project, 0, 1)).rejects.toBe(failure);
});
