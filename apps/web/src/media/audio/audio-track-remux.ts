import { Mp4Writer } from "@/media/mux/mp4-writer";
import type { ByteSource } from "@/renderer/mp4-decoder";
import { openMp4 } from "@/renderer/mp4-demux";

// Pulls the AAC track out of an MP4/MOV and writes it back as an audio-only
// MP4 without touching the codec data. The result is what playback, waveform
// extraction and the export mixer decode instead of the full original, so a
// multi-gigabyte 4K source never has to be read or held whole for its audio.
// Reads go through ByteSource, so both OPFS copies and referenced files work.

export interface RemuxedAudio {
  readonly blob: Blob;
  readonly codec: string;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly sampleCount: number;
  readonly durationMs: number;
}

const isAac = (codec: string): boolean => /^mp4a\.40\./.test(codec);

// AudioSpecificConfig from the sample description. Without it the muxed file
// could not be decoded, so a source without one is treated as unsupported
// rather than guessed at.
const audioSpecificConfig = (config: AudioDecoderConfig | null): Uint8Array | null => {
  const description = config?.description;
  if (!description) return null;
  if (description instanceof Uint8Array) return description;
  if (description instanceof ArrayBuffer) return new Uint8Array(description);
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
  }
  return null;
};

export const remuxAudioTrack = async (source: ByteSource): Promise<RemuxedAudio | null> => {
  if (source.size === 0) return null;
  const opened = await openMp4(source);
  const track = opened?.audioTrack ?? null;
  if (!opened || !track) {
    opened?.dispose();
    return null;
  }
  try {
    if (!isAac(track.codec)) return null;
    const description = audioSpecificConfig(track.config);
    if (!description) return null;

    const { sampleRate, channelCount } = track;
    const muxer = new Mp4Writer({
      audio: { codec: "aac", numberOfChannels: channelCount, sampleRate },
    });
    let sampleCount = 0;
    try {
      for await (const packet of track.packets.packets()) {
        muxer.addAudioChunkRaw(
          packet.data,
          packet.type,
          packet.timestampUs,
          packet.durationUs,
          sampleCount === 0
            ? {
                decoderConfig: {
                  codec: track.codec,
                  sampleRate,
                  numberOfChannels: channelCount,
                  description,
                },
              }
            : undefined,
        );
        sampleCount += 1;
      }
    } catch {
      // A source that cannot be read to the end has no usable variant; muxer
      // failures surface from finalize() below instead of hiding here.
      return null;
    }
    if (sampleCount === 0) return null;

    const buffer = await muxer.finalize();
    return {
      blob: new Blob([buffer], { type: "audio/mp4" }),
      codec: track.codec,
      sampleRate,
      channelCount,
      sampleCount,
      durationMs: Math.round(track.durationMs),
    };
  } finally {
    opened.dispose();
  }
};
