import { vi } from "vitest";
import type { DemuxPacket, OpenedMp4, PacketReader } from "../mp4-demux";

// A four-packet track (one frame every 40 ms) behind a fake packet reader
// and fake WebCodecs objects, so decoder and sampler contracts can be
// exercised in node without a real MP4 or hardware decoder.

export interface FakeFrame {
  readonly timestamp: number;
  closed: number;
  close(): void;
}

export const SAMPLE_COUNT = 4;

const packetAt = (index: number): DemuxPacket => ({
  timestampUs: index * 40_000,
  durationUs: 40_000,
  type: index === 0 ? "key" : "delta",
  data: new Uint8Array([index]),
  sequence: index,
});

// `emitOn: "flush"` holds decoded frames back and releases them in one burst,
// the way a hardware decoder drains its reorder queue.
export const installFakeWebCodecs = (emitOn: "decode" | "flush"): FakeFrame[] => {
  const frames: FakeFrame[] = [];
  class FakeVideoDecoder {
    static isConfigSupported = async () => ({ supported: true });
    decodeQueueSize = 0;
    readonly #output: (frame: FakeFrame) => void;
    readonly #held: FakeFrame[] = [];
    constructor(init: { output: (frame: FakeFrame) => void }) {
      this.#output = init.output;
    }
    configure() {}
    decode(chunk: { timestamp: number }) {
      const frame: FakeFrame = {
        timestamp: chunk.timestamp,
        closed: 0,
        close() {
          this.closed += 1;
        },
      };
      frames.push(frame);
      if (emitOn === "decode") this.#output(frame);
      else this.#held.push(frame);
    }
    async flush() {
      for (const frame of this.#held.splice(0)) this.#output(frame);
    }
    close() {}
  }
  class FakeChunk {
    readonly timestamp: number;
    constructor(init: { timestamp: number }) {
      this.timestamp = init.timestamp;
    }
  }
  vi.stubGlobal("VideoDecoder", FakeVideoDecoder);
  vi.stubGlobal("EncodedVideoChunk", FakeChunk);
  return frames;
};

const fakePacketReader = (packets: readonly DemuxPacket[]): PacketReader => ({
  keyPacketAt: async (timestampUs) => {
    let found: DemuxPacket | null = null;
    for (const packet of packets) {
      if (packet.type === "key" && packet.timestampUs <= timestampUs) found = packet;
    }
    return found ?? packets.find((packet) => packet.type === "key") ?? null;
  },
  nextPacket: async (packet) => {
    if (!packets.includes(packet)) throw new Error("packet was not handed out by this reader");
    return packets[packet.sequence + 1] ?? null;
  },
  keyTimesMs: async () =>
    packets.filter((packet) => packet.type === "key").map((packet) => packet.timestampUs / 1000),
  packets: async function* (from) {
    if (from && !packets.includes(from))
      throw new Error("packet was not handed out by this reader");
    yield* packets.slice(from ? from.sequence : 0);
  },
});

export const openedFixture = (): OpenedMp4 => {
  const packets = Array.from({ length: SAMPLE_COUNT }, (_, i) => packetAt(i));
  return {
    source: { size: 400, read: async () => new ArrayBuffer(0) },
    container: "mp4",
    videoTrack: {
      codec: "avc1.42E01E",
      codedWidth: 16,
      codedHeight: 16,
      rotation: 0,
      config: { codec: "avc1.42E01E", codedWidth: 16, codedHeight: 16 },
      packets: fakePacketReader(packets),
    },
    audioTrack: null,
    durationMs: 160,
    dispose() {},
  };
};
