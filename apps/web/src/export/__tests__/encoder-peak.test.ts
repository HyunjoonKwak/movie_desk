import { createEmptyProject, TruePeakMeter } from "@movie-desk/core";
import { afterEach, expect, it, vi } from "vitest";
import { WebCodecsExporter } from "../exporter";
import { PRESETS } from "../presets";
vi.mock("@/renderer/compositor", () => ({
  Compositor: class {
    resize() {}
    setPlayheadGetter() {}
    async renderFrame() {}
    dispose() {}
  },
}));
vi.mock("@/stores/project-store", () => ({
  useProjectStore: { getState: () => ({ project: createEmptyProject() }) },
}));
vi.mock("@/stores/range-store", () => ({
  useRangeStore: { getState: () => ({ inMs: null, outMs: null }) },
}));
vi.mock("@/media/mux/mp4-writer", () => ({
  Mp4Writer: class {
    addVideoChunk() {}
    addAudioChunk() {}
    async finalize() {
      return new ArrayBuffer(0);
    }
  },
}));
vi.mock("../aac-priming", () => ({
  AAC_PREROLL_SAMPLES: 4096,
  measureAacPriming: async () => {
    throw new Error("unavailable");
  },
}));
vi.mock("../normalize-store", () => ({
  useNormalizeStore: { getState: () => ({ enabled: true, targetLufs: 0 }) },
}));
vi.mock("../loudness", () => ({
  LoudnessMeter: class {
    push() {}
    result() {
      return { integratedLufs: -20 };
    }
  },
}));
vi.mock("../audio-mixer", async (original) => ({
  ...(await original<typeof import("../audio-mixer")>()),
  ProjectAudioMixer: class {
    sampleRate = 48000;
    async *chunks() {
      for (let i = 0; i < 2; i++)
        yield {
          channels: [new Float32Array(1025).fill(0.5), new Float32Array(1025).fill(0.25)],
          startSample: i * 1025,
          sampleRate: 48000,
          limitedSamples: 3,
        };
    }
    dispose() {}
  },
}));
afterEach(() => vi.unstubAllGlobals());
it("reports post-clamp encoder PCM peaks separately from pre-clamp overload counts", async () => {
  const encoded: Float32Array[] = [];
  class FakeEncoder {
    static async isConfigSupported() {
      return { supported: true };
    }
    state = "configured";
    encodeQueueSize = 0;
    configure() {}
    encode(data: { pcm?: Float32Array }) {
      if (data.pcm) encoded.push(data.pcm);
    }
    async flush() {}
    close() {
      this.state = "closed";
    }
  }
  vi.stubGlobal("window", { VideoEncoder: FakeEncoder, VideoDecoder: class {} });
  vi.stubGlobal("VideoEncoder", FakeEncoder);
  vi.stubGlobal("AudioEncoder", FakeEncoder);
  vi.stubGlobal(
    "VideoFrame",
    class {
      close() {}
    },
  );
  vi.stubGlobal(
    "AudioData",
    class {
      pcm: Float32Array;
      constructor(init: { data: Float32Array }) {
        this.pcm = init.data.slice();
      }
      close() {}
    },
  );
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0 }) });
  const result = await new WebCodecsExporter().start(
    { projectId: createEmptyProject().id, preset: PRESETS[0]! },
    vi.fn(),
  );
  expect(encoded).toHaveLength(4);
  const expected = new TruePeakMeter(2);
  for (const planar of encoded) {
    expect(planar.every((sample) => sample === 1)).toBe(true);
    expected.push([planar.subarray(0, planar.length / 2), planar.subarray(planar.length / 2)]);
  }
  expect(result.audioPeaks).toEqual({
    ...expected.finish(),
    clippedSamples: 4100,
    limitedSamples: 6,
  });
  expect(result.audioPeaks!.samplePeak).toBe(1);
  expect(result.audioPeaks!.truePeak).toBeLessThan(2);
});
