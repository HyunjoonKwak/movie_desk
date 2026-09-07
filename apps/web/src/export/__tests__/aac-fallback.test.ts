import { readFile } from "node:fs/promises";
import path from "node:path";
import * as presentation from "@/media/mux/audio-presentation";
import { createEmptyProject } from "@movie-desk/core";
import {
  ALL_FORMATS,
  BufferSource,
  type EncodedPacket,
  EncodedPacketSink,
  Input,
} from "mediabunny";
import { afterEach, expect, it, vi } from "vitest";
import * as priming from "../aac-priming";
import { WebCodecsExporter } from "../exporter";
import { PRESETS } from "../presets";

// These tests isolate audio/mux timing with frozen packets; real color output is
// verified separately by bt709-frame tests and the GPU/codec audit.
vi.mock("../bt709-frame", () => ({
  Bt709FrameCapture: class {
    dispose() {}
    capture() {
      return { close() {} };
    }
  },
  isBt709Output: () => true,
}));
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
vi.mock("../audio-mixer", async (original) => ({
  ...(await original<typeof import("../audio-mixer")>()),
  ProjectAudioMixer: class {
    sampleRate = 48000;
    pitchFallback = false;
    async *chunks() {
      yield {
        channels: [new Float32Array(48000), new Float32Array(48000)],
        sampleRate: 48000,
        startSample: 0,
      };
    }
    dispose() {}
  },
}));
const open = (buffer: ArrayBuffer) =>
  new Input({ source: new BufferSource(buffer), formats: ALL_FORMATS });
const webChunk = (packet: EncodedPacket) => ({
  type: packet.type,
  timestamp: packet.timestamp * 1e6,
  duration: packet.duration * 1e6,
  byteLength: packet.data.length,
  copyTo: (target: Uint8Array) => target.set(packet.data),
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Mode = "missing decoder" | "failed correlation" | "missing edit reservation";

// Real AAC/AVC packets from the fixture are replayed through fake WebCodecs
// encoders so the muxer sees genuine bitstreams; the decoder side is what
// each mode breaks. `audioDataInits` records what the export fed the encoder.
const setup = async (mode: Mode) => {
  const audioDataInits: { timestamp: number; numberOfFrames: number }[] = [];
  let encodeCalls = 0;
  const fixture = await readFile(
    path.join(__dirname, "../../media/__tests__/fixtures/aac-video.mp4"),
  );
  const input = open(Uint8Array.from(fixture).buffer);
  const audio = (await input.getPrimaryAudioTrack())!;
  const video = (await input.getPrimaryVideoTrack())!;
  const audioConfig = (await audio.getDecoderConfig())!;
  const videoConfig = (await video.getDecoderConfig())!;
  const audioPackets: EncodedPacket[] = [];
  const videoPackets: EncodedPacket[] = [];
  for await (const packet of new EncodedPacketSink(audio).packets()) audioPackets.push(packet);
  for await (const packet of new EncodedPacketSink(video).packets()) videoPackets.push(packet);
  class FakeAudioEncoder {
    static async isConfigSupported() {
      return { supported: true };
    }
    state = "configured";
    encodeQueueSize = 0;
    constructor(private init: AudioEncoderInit) {}
    configure() {}
    encode() {
      encodeCalls += 1;
    }
    close() {
      this.state = "closed";
    }
    async flush() {
      audioPackets.forEach((p, i) =>
        this.init.output(
          webChunk(p) as unknown as EncodedAudioChunk,
          i === 0 ? { decoderConfig: audioConfig } : {},
        ),
      );
    }
  }
  class FakeVideoEncoder {
    state = "configured";
    encodeQueueSize = 0;
    constructor(private init: VideoEncoderInit) {}
    configure() {}
    private submitted = 0;
    private emitted = 0;
    encode() {
      this.submitted++;
    }
    close() {
      this.state = "closed";
    }
    async flush() {
      // Flush drains submitted frames; preflight adds an early flush and must
      // never replay an already emitted GOP on the final flush.
      const end = Math.min(this.submitted, videoPackets.length);
      for (let i = this.emitted; i < end; i++) {
        this.init.output(
          webChunk(videoPackets[i]!) as unknown as EncodedVideoChunk,
          i === 0 ? { decoderConfig: videoConfig } : {},
        );
      }
      this.emitted = end;
    }
  }
  vi.stubGlobal("window", { VideoEncoder: FakeVideoEncoder, VideoDecoder: class {} });
  vi.stubGlobal("VideoEncoder", FakeVideoEncoder);
  vi.stubGlobal("AudioEncoder", FakeAudioEncoder);
  vi.stubGlobal(
    "VideoFrame",
    class {
      close() {}
    },
  );
  vi.stubGlobal(
    "AudioData",
    class {
      constructor(init: { timestamp: number; numberOfFrames: number }) {
        audioDataInits.push({ timestamp: init.timestamp, numberOfFrames: init.numberOfFrames });
      }
      close() {}
    },
  );
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0 }) });
  vi.stubGlobal(
    "AudioDecoder",
    mode === "missing decoder"
      ? undefined
      : class {
          state = "configured";
          configure() {}
          decode() {}
          async flush() {}
          close() {
            this.state = "closed";
          }
        },
  );
  if (mode === "missing edit reservation") {
    vi.spyOn(priming, "measureAacPriming").mockResolvedValueOnce(1024);
    const apply = presentation.applyAudioPresentation;
    vi.spyOn(presentation, "applyAudioPresentation").mockImplementationOnce((buffer, spec) => {
      const elst = Buffer.from(buffer).indexOf("elst") - 4;
      expect(elst).toBeGreaterThan(0);
      new DataView(buffer).setUint32(elst + 12, 1);
      apply(buffer, spec); // production validation throws
    });
  }
  const start = () =>
    new WebCodecsExporter().start(
      { projectId: createEmptyProject().id, preset: PRESETS[0]! },
      vi.fn(),
    );
  return { start, input, audioPackets, audioDataInits, encodeCalls: () => encodeCalls };
};

it.each(["missing decoder", "failed correlation"] as const)(
  "finishes an audio/video export with a notice on %s",
  async (mode) => {
    const { start, input, audioPackets, audioDataInits, encodeCalls } = await setup(mode);
    const result = await start();
    expect(result.aacCorrectionFallback).toBe(true);
    expect(result.blob.size).toBeGreaterThan(1000);
    // Without the correction nothing is padded: the mixer's single 48,000
    // sample chunk is fed as ceil(48000/1024) frames whose timestamps start
    // at 0 (the calibration probe adds its own AudioData before the export).
    const frames = Math.ceil(48000 / 1024);
    const expectedTimestamps = Array.from({ length: frames }, (_, i) =>
      Math.round(((i * 1024) / 48000) * 1_000_000),
    );
    // The export loop runs after the calibration probe, so its frames are the
    // last `frames` entries; a preroll shift would offset every timestamp by
    // 85,333 µs and an end pad would append a 4,096-frame entry.
    const exportInits = audioDataInits.slice(-frames);
    expect(exportInits.map((init) => init.timestamp)).toEqual(expectedTimestamps);
    expect(audioDataInits.some((init) => init.numberOfFrames === 4096)).toBe(false);
    expect(encodeCalls()).toBe(frames + 1); // export frames plus the calibration probe
    const output = open(await result.blob.arrayBuffer());
    const outAudio = (await output.getPrimaryAudioTrack())!;
    expect(outAudio).not.toBeNull();
    expect(await output.getPrimaryVideoTrack()).not.toBeNull();
    const packets: EncodedPacket[] = [];
    for await (const packet of new EncodedPacketSink(outAudio).packets()) packets.push(packet);
    expect(packets).toHaveLength(audioPackets.length);
    expect(packets[0]!.timestamp).toBe(0); // no leaked one-second reservation
    expect(packets.map((p) => p.data)).toEqual(audioPackets.map((p) => p.data));
    input.dispose();
    output.dispose();
  },
);

it("fails loudly instead of shipping late audio when the edit-list reservation is missing", async () => {
  const { start, input } = await setup("missing edit reservation");
  await expect(start()).rejects.toThrow(/AAC presentation could not be applied/);
  input.dispose();
});
