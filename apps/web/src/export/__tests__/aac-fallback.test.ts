import { readFile } from "node:fs/promises";
import path from "node:path";
import { createEmptyProject } from "@movie-desk/core";
import {
  ALL_FORMATS,
  BufferSource,
  EncodedPacketSink,
  Input,
  type EncodedPacket,
} from "mediabunny";
import { afterEach, expect, it, vi } from "vitest";
import * as priming from "../aac-priming";
import * as presentation from "@/media/mux/audio-presentation";
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

it.each(["missing decoder", "failed correlation", "missing edit reservation"])(
  "finishes an audio/video export with a notice on %s",
  async (mode) => {
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
      encode() {}
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
      encode() {}
      close() {
        this.state = "closed";
      }
      async flush() {
        videoPackets.forEach((p, i) =>
          this.init.output(
            webChunk(p) as unknown as EncodedVideoChunk,
            i === 0 ? { decoderConfig: videoConfig } : {},
          ),
        );
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
        apply(buffer, spec); // production validation throws; writer must remux
      });
    }
    const result = await new WebCodecsExporter().start(
      { projectId: createEmptyProject().id, preset: PRESETS[0]! },
      vi.fn(),
    );
    expect(result.aacCorrectionFallback).toBe(true);
    expect(result.blob.size).toBeGreaterThan(1000);
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
