import { createEmptyProject } from "@movie-desk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebCodecsExporter } from "../exporter";
import { PRESETS } from "../presets";

const harness = vi.hoisted(() => ({
  project: null as ReturnType<typeof createEmptyProject> | null,
  renderFrame: vi.fn(),
  dispose: vi.fn(),
  encoderClose: vi.fn(),
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

vi.mock("mp4-muxer", () => ({
  ArrayBufferTarget: class {
    buffer = new ArrayBuffer(0);
  },
  Muxer: class {
    target: { buffer: ArrayBuffer };
    constructor(options: { target: { buffer: ArrayBuffer } }) {
      this.target = options.target;
    }
    addVideoChunk() {}
    addAudioChunk() {}
    finalize() {}
  },
}));

class FakeVideoEncoder {
  state: CodecState = "unconfigured";
  configure() {
    this.state = "configured";
  }
  encode() {}
  async flush() {}
  close() {
    this.state = "closed";
    harness.encoderClose();
  }
}

describe("WebCodecsExporter resource cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
