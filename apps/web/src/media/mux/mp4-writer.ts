import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  type Rotation,
} from "mediabunny";

// One MP4 writer for every place that muxes WebCodecs output (export, proxy,
// audio-track cache, generated transitions). A thin layer over mediabunny —
// the maintained successor of mp4-muxer — keeping the surface those call
// sites already had: chunks arrive from encoder callbacks, `finalize()`
// returns the file. Every track is re-based so its first packet lands at 0
// (what mp4-muxer called `firstTimestampBehavior: "offset"`), and the moov
// box is written before the media data so playback can start immediately.

type Mp4VideoCodec = "avc" | "hevc" | "vp9" | "av1";
type Mp4AudioCodec = "aac" | "opus";
export type Mp4ChunkType = "key" | "delta";

export interface Mp4WriterOptions {
  readonly video?: {
    readonly codec: Mp4VideoCodec;
    readonly width: number;
    readonly height: number;
    readonly frameRate?: number;
    readonly rotation?: Rotation;
  };
  readonly audio?: {
    readonly codec: Mp4AudioCodec;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
  };
}

// Timestamps arrive in microseconds (WebCodecs); packets leave in seconds
// relative to the track's first packet.
class TrackClock {
  private firstUs: number | null = null;
  private count = 0;

  next(timestampUs: number): { timestamp: number; sequence: number } {
    if (this.firstUs === null) this.firstUs = timestampUs;
    const sequence = this.count;
    this.count += 1;
    return { timestamp: (timestampUs - this.firstUs) / 1_000_000, sequence };
  }
}

const copyChunk = (chunk: EncodedVideoChunk | EncodedAudioChunk): Uint8Array => {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return data;
};

export class Mp4Writer {
  private readonly output: Output<Mp4OutputFormat, BufferTarget>;
  private readonly target = new BufferTarget();
  private readonly video: EncodedVideoPacketSource | null;
  private readonly audio: EncodedAudioPacketSource | null;
  private readonly videoClock = new TrackClock();
  private readonly audioClock = new TrackClock();
  // Packet writes are serialised behind start(); encoder callbacks cannot
  // await, so the chain carries the first failure to finalize().
  private queue: Promise<void>;
  private failure: Error | null = null;

  constructor(options: Mp4WriterOptions) {
    if (!options.video && !options.audio)
      throw new Error("Mp4Writer needs a video or an audio track");
    this.output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: this.target,
    });
    this.video = options.video ? new EncodedVideoPacketSource(options.video.codec) : null;
    if (this.video && options.video) {
      this.output.addVideoTrack(this.video, {
        ...(options.video.frameRate ? { frameRate: options.video.frameRate } : {}),
        ...(options.video.rotation ? { rotation: options.video.rotation } : {}),
      });
    }
    this.audio = options.audio ? new EncodedAudioPacketSource(options.audio.codec) : null;
    if (this.audio) this.output.addAudioTrack(this.audio);
    this.queue = this.output.start();
  }

  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    this.addVideoChunkRaw(copyChunk(chunk), chunk.type, chunk.timestamp, chunk.duration ?? 0, meta);
  }

  addVideoChunkRaw(
    data: Uint8Array,
    type: Mp4ChunkType,
    timestampUs: number,
    durationUs: number,
    meta?: EncodedVideoChunkMetadata,
  ): void {
    const source = this.video;
    if (!source) throw new Error("Mp4Writer has no video track");
    const { timestamp, sequence } = this.videoClock.next(timestampUs);
    const packet = new EncodedPacket(data, type, timestamp, durationUs / 1_000_000, sequence);
    this.enqueue(() => source.add(packet, meta));
  }

  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void {
    this.addAudioChunkRaw(copyChunk(chunk), chunk.type, chunk.timestamp, chunk.duration ?? 0, meta);
  }

  addAudioChunkRaw(
    data: Uint8Array,
    type: Mp4ChunkType,
    timestampUs: number,
    durationUs: number,
    meta?: EncodedAudioChunkMetadata,
  ): void {
    const source = this.audio;
    if (!source) throw new Error("Mp4Writer has no audio track");
    const { timestamp, sequence } = this.audioClock.next(timestampUs);
    const packet = new EncodedPacket(data, type, timestamp, durationUs / 1_000_000, sequence);
    this.enqueue(() => source.add(packet, meta));
  }

  // Resolves to the complete MP4 once every queued packet has been written.
  async finalize(): Promise<ArrayBuffer> {
    await this.queue;
    if (this.failure) throw this.failure;
    await this.output.finalize();
    const buffer = this.target.buffer;
    if (!buffer) throw new Error("MP4 finalize produced no data");
    return buffer;
  }

  private enqueue(step: () => Promise<void>): void {
    this.queue = this.queue.then(step).catch((error: unknown) => {
      this.failure ??= error instanceof Error ? error : new Error(String(error));
    });
  }
}
