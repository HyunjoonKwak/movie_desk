import { createEmptyProject } from "@movie-desk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebCodecsExporter } from "../exporter";
import { PRESETS } from "../presets";

const harness = vi.hoisted(() => ({
  project: null as ReturnType<typeof createEmptyProject> | null,
  renderFrame: vi.fn(),
  dispose: vi.fn(),
  encoderClose: vi.fn(),
  metadata: undefined as VideoColorSpaceInit | undefined,
  frameClose: vi.fn(),
  encode: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/renderer/compositor", () => ({
  Compositor: class {
    resize() {}
    setPlayheadGetter() {}
    renderFrame = harness.renderFrame;
    dispose = harness.dispose;
  },
}));

vi.mock("@/stores/project-store", () => ({
  useProjectStore: {
    getState: () => ({ project: harness.project }),
  },
}));

vi.mock("@/stores/range-store", () => ({
  useRangeStore: {
    getState: () => ({ inMs: null, outMs: null }),
  },
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

vi.mock("../bt709-pipeline", () => ({
  Bt709FramePipeline: class {
    async capture(timestamp: number) {
      harness.capture(timestamp);
      return { close: harness.frameClose };
    }
    dispose() {}
  },
}));

class FakeVideoEncoder {
  constructor(private readonly callbacks: VideoEncoderInit) {}
  state: CodecState = "unconfigured";
  configure() {
    this.state = "configured";
  }
  encode() {
    harness.encode();
    this.callbacks.output({} as EncodedVideoChunk, {
      decoderConfig: {
        codec: "vp9",
        ...(harness.metadata ? { colorSpace: harness.metadata } : {}),
      },
    });
  }
  async flush() {}
  close() {
    this.state = "closed";
    harness.encoderClose();
  }
}

describe("WebCodecsExporter resource cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.metadata = undefined;
    harness.project = createEmptyProject();
    harness.renderFrame.mockRejectedValue(new Error("render failed"));
    vi.stubGlobal("window", { VideoEncoder: FakeVideoEncoder, VideoDecoder: class {} });
    vi.stubGlobal("VideoEncoder", FakeVideoEncoder);
    vi.stubGlobal("AudioEncoder", FakeVideoEncoder);
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0 }) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes the encoder and compositor when frame rendering fails", async () => {
    const project = harness.project;
    const preset = PRESETS[0];
    expect(project).not.toBeNull();
    expect(preset).toBeDefined();
    if (!project || !preset) return;

    await expect(
      new WebCodecsExporter().start({ projectId: project.id, preset }, vi.fn()),
    ).rejects.toThrow("render failed");

    expect(harness.encoderClose).toHaveBeenCalledOnce();
    expect(harness.dispose).toHaveBeenCalledOnce();
  });
  it("continues with approximation when encoder metadata is absent", async () => {
    harness.project = {
      ...harness.project!,
      timeline: { ...harness.project!.timeline, duration: 100 },
    };
    harness.renderFrame.mockResolvedValue(undefined);
    const result = await new WebCodecsExporter().start(
      { projectId: harness.project!.id, preset: PRESETS[0]! },
      vi.fn(),
    );
    expect(result.colorApproximation).toBe(true);
    expect(harness.capture.mock.calls.map(([timestamp]) => timestamp)).toEqual([0, 33333, 66667]);
    expect(harness.renderFrame).toHaveBeenCalledTimes(3);
    expect(harness.encode).toHaveBeenCalledTimes(3);
    expect(harness.frameClose).toHaveBeenCalledTimes(harness.encode.mock.calls.length);
  });

  it("rejects non-BT709 metadata after only the preflight frame", async () => {
    harness.renderFrame.mockResolvedValue(undefined);
    harness.metadata = {
      primaries: "bt709",
      transfer: "bt709",
      matrix: "smpte170m",
      fullRange: false,
    };
    await expect(
      new WebCodecsExporter().start(
        { projectId: harness.project!.id, preset: PRESETS[0]! },
        vi.fn(),
      ),
    ).rejects.toThrow("color.encoderMismatch");
    expect(harness.renderFrame).toHaveBeenCalledOnce();
    expect(harness.encode).toHaveBeenCalledOnce();
    expect(harness.frameClose).toHaveBeenCalledOnce();
    expect(harness.encoderClose).toHaveBeenCalledOnce();
  });
});
