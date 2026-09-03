import { vi } from "vitest";
import type { Mp4Sample, OpenedMp4 } from "../mp4-demux";

// A four-sample track (one frame every 40 ms, 100 bytes each) behind fake
// mp4box and WebCodecs objects, so decoder and sampler contracts can be
// exercised in node without a real MP4 or hardware decoder.

export interface FakeFrame {
  readonly timestamp: number;
  closed: number;
  close(): void;
}

export const SAMPLE_BYTES = 100;
export const SAMPLE_COUNT = 4;

const sampleAt = (index: number): Mp4Sample => ({
  cts: index * 40,
  dts: index * 40,
  duration: 40,
  timescale: 1000,
  is_sync: index === 0,
  number: index,
  data: new Uint8Array([index]),
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

export const openedFixture = (): OpenedMp4 => {
  const samples = Array.from({ length: SAMPLE_COUNT }, (_, i) => sampleAt(i));
  const table = samples.map((s, i) => ({
    cts: s.cts,
    timescale: s.timescale,
    offset: i * SAMPLE_BYTES,
    size: SAMPLE_BYTES,
  }));
  const file = {
    onSamples: (() => {}) as (id: number, user: unknown, samples: readonly Mp4Sample[]) => void,
    getTrackById: () => ({ samples: table }),
    setExtractionOptions() {},
    unsetExtractionOptions() {},
    start() {},
    stop() {},
    flush() {},
    seekTrack: () => ({ offset: 0 }),
    appendBuffer(buffer: ArrayBuffer & { fileStart: number }) {
      const from = buffer.fileStart;
      const to = from + buffer.byteLength;
      const inChunk = table
        .map((entry, i) => (entry.offset >= from && entry.offset < to ? samples[i] : null))
        .filter((s): s is Mp4Sample => s !== null);
      file.onSamples(1, null, inChunk);
      return to;
    },
  };
  const size = SAMPLE_COUNT * SAMPLE_BYTES;
  return {
    source: {
      size,
      read: async (offset: number, length: number) => {
        const chunk = new ArrayBuffer(Math.min(length, size - offset)) as ArrayBuffer & {
          fileStart: number;
        };
        chunk.fileStart = offset;
        return chunk;
      },
    },
    file,
    info: { duration: 160, timescale: 1000, brands: [], videoTracks: [], audioTracks: [] },
    videoTrack: {
      id: 1,
      codec: "avc1.42E01E",
      timescale: 1000,
      duration: 160,
      nb_samples: SAMPLE_COUNT,
      video: { width: 16, height: 16 },
    },
    durationMs: 160,
  } as unknown as OpenedMp4;
};
