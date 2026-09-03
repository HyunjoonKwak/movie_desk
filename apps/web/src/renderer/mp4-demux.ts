import {
  CustomSource,
  type EncodedPacket,
  EncodedPacketSink,
  Input,
  type InputAudioTrack,
  type InputTrack,
  type InputVideoTrack,
  MP4,
  QTFF,
  QuickTimeInputFormat,
} from "mediabunny";
import type { SourceRotation } from "@movie-desk/core";
import type { ByteSource } from "./mp4-decoder";

// The one demuxer for ISO BMFF sources (MP4, QuickTime .mov): mediabunny's
// Input over a ranged ByteSource, so an OPFS copy and a referenced file
// behind media:// look the same, and only the bytes a consumer asks for are
// read. Packets come out in decode order with presentation timestamps (edit
// lists already applied), which is exactly what a WebCodecs decoder wants.

export interface DemuxPacket {
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly type: "key" | "delta";
  readonly data: Uint8Array;
  readonly sequence: number;
}

// Random access into one track's packets. Implemented over mediabunny here
// and by a tiny in-memory table in tests.
export interface PacketReader {
  // The key packet at or before `timestampUs`, else the first key packet.
  keyPacketAt(timestampUs: number): Promise<DemuxPacket | null>;
  // The next packet in decode order.
  nextPacket(packet: DemuxPacket): Promise<DemuxPacket | null>;
  // Presentation times (ms) of every key packet.
  keyTimesMs(): Promise<number[]>;
  // Every packet in decode order.
  packets(): AsyncIterable<DemuxPacket>;
}

interface VideoTrackInfo {
  readonly codec: string;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly rotation: SourceRotation;
  readonly config: VideoDecoderConfig | null;
  readonly packets: PacketReader;
}

interface AudioTrackInfo {
  readonly codec: string;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly config: AudioDecoderConfig | null;
  readonly durationMs: number;
  readonly packets: PacketReader;
}

export interface OpenedMp4 {
  readonly source: ByteSource;
  readonly container: "mp4" | "mov";
  readonly videoTrack: VideoTrackInfo | null;
  readonly audioTrack: AudioTrackInfo | null;
  readonly durationMs: number;
  dispose(): void;
}

const toPacket = (packet: EncodedPacket): DemuxPacket => ({
  timestampUs: Math.round(packet.timestamp * 1_000_000),
  durationUs: Math.round(packet.duration * 1_000_000),
  type: packet.type,
  data: packet.data,
  sequence: packet.sequenceNumber,
});

const packetReader = (track: InputTrack): PacketReader => {
  const sink = new EncodedPacketSink(track);
  // Our packets stay plain data; the mediabunny originals are kept aside so
  // nextPacket can continue from them.
  const originals = new WeakMap<DemuxPacket, EncodedPacket>();
  const wrap = (packet: EncodedPacket | null): DemuxPacket | null => {
    if (!packet) return null;
    const out = toPacket(packet);
    originals.set(out, packet);
    return out;
  };
  return {
    keyPacketAt: async (timestampUs) =>
      wrap(
        (await sink.getKeyPacket(Math.max(0, timestampUs) / 1_000_000)) ??
          (await sink.getFirstKeyPacket()),
      ),
    nextPacket: async (packet) => {
      const original = originals.get(packet);
      return original ? wrap(await sink.getNextPacket(original)) : null;
    },
    keyTimesMs: async () => {
      const times: number[] = [];
      const options = { metadataOnly: true };
      for (
        let packet = await sink.getFirstKeyPacket(options);
        packet;
        packet = await sink.getNextKeyPacket(packet, options)
      ) {
        times.push(packet.timestamp * 1000);
      }
      return times;
    },
    packets: async function* () {
      for await (const packet of sink.packets()) yield toPacket(packet);
    },
  };
};

const videoInfo = async (track: InputVideoTrack): Promise<VideoTrackInfo> => ({
  codec: (await track.getCodecParameterString()) ?? "",
  codedWidth: track.codedWidth,
  codedHeight: track.codedHeight,
  rotation: track.rotation,
  config: await track.getDecoderConfig().catch(() => null),
  packets: packetReader(track),
});

const audioInfo = async (track: InputAudioTrack): Promise<AudioTrackInfo> => ({
  codec: (await track.getCodecParameterString()) ?? "",
  sampleRate: track.sampleRate,
  channelCount: track.numberOfChannels,
  config: await track.getDecoderConfig().catch(() => null),
  durationMs: (await track.computeDuration()) * 1000,
  packets: packetReader(track),
});

const inputFor = (source: ByteSource): Input =>
  new Input({
    formats: [MP4, QTFF],
    source: new CustomSource({
      getSize: () => source.size,
      read: async (start, end) => new Uint8Array(await source.read(start, end - start)),
    }),
  });

// Reads the metadata window and describes the primary tracks. Null when the
// bytes are not an ISO BMFF file (or cannot be read at all).
export const openMp4 = async (source: ByteSource): Promise<OpenedMp4 | null> => {
  if (source.size === 0) return null;
  const input = inputFor(source);
  try {
    const format = await input.getFormat();
    const [video, audio, durationSeconds] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
      input.computeDuration(),
    ]);
    return {
      source,
      container: format instanceof QuickTimeInputFormat ? "mov" : "mp4",
      videoTrack: video ? await videoInfo(video) : null,
      audioTrack: audio ? await audioInfo(audio) : null,
      durationMs: durationSeconds * 1000,
      dispose: () => input.dispose(),
    };
  } catch {
    input.dispose();
    return null;
  }
};

export const videoDecoderConfig = (opened: OpenedMp4): VideoDecoderConfig | null =>
  opened.videoTrack?.config ?? null;
