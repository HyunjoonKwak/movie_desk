import { Mp4Writer } from "@/media/mux/mp4-writer";
import type { ByteSource } from "@/renderer/mp4-decoder";
import { quietMp4BoxLogs } from "@/renderer/mp4box-log";

// Pulls the AAC track out of an MP4/MOV and writes it back as an audio-only
// MP4 without touching the codec data. The result is what playback, waveform
// extraction and the export mixer decode instead of the full original, so a
// multi-gigabyte 4K source never has to be read or held whole for its audio.
// Reads go through ByteSource, so both OPFS copies and referenced files work.

interface Mp4Sample {
  readonly cts: number;
  readonly dts: number;
  readonly duration: number;
  readonly timescale: number;
  readonly is_sync: boolean;
  readonly data?: Uint8Array;
}

interface Mp4AudioTrack {
  readonly id: number;
  readonly codec: string;
  readonly timescale: number;
  readonly duration: number;
  readonly nb_samples: number;
  readonly audio?: { readonly sample_rate: number; readonly channel_count: number };
}

interface Mp4Info {
  readonly audioTracks: readonly Mp4AudioTrack[];
}

type Mp4ArrayBuffer = ArrayBuffer & { fileStart: number };

interface Mp4File {
  onError: (error: string) => void;
  onReady: (info: Mp4Info) => void;
  onSamples: (id: number, user: unknown, samples: readonly Mp4Sample[]) => void;
  setExtractionOptions: (id: number, user: unknown, options: { nbSamples: number }) => void;
  appendBuffer: (buffer: Mp4ArrayBuffer, last?: boolean) => number;
  start: () => void;
  stop: () => void;
  flush: () => void;
  seekTrack: (timeSeconds: number, useRap: boolean, track: unknown) => { offset: number };
  getTrackById: (id: number) => unknown;
}

export interface RemuxedAudio {
  readonly blob: Blob;
  readonly codec: string;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly sampleCount: number;
  readonly durationMs: number;
}

const METADATA_CHUNK_BYTES = 1 * 1024 * 1024;
const SAMPLE_CHUNK_BYTES = 4 * 1024 * 1024;
const EXTRACTION_BATCH = 512;

const isAac = (codec: string): boolean => /^mp4a\.40\./.test(codec);

// AudioSpecificConfig lives in the esds box's DecoderSpecificInfo (tag 5).
// Without it the muxed file could not be decoded, so a source without one is
// treated as unsupported rather than guessed at.
const decoderSpecificInfo = (file: Mp4File, trackId: number): Uint8Array | null => {
  try {
    const trak = file.getTrackById(trackId) as {
      mdia?: {
        minf?: {
          stbl?: {
            stsd?: {
              entries?: {
                esds?: {
                  esd?: {
                    descs?: { tag?: number; descs?: { tag?: number; data?: Uint8Array }[] }[];
                  };
                };
              }[];
            };
          };
        };
      };
    };
    const descriptor = trak.mdia?.minf?.stbl?.stsd?.entries?.[0]?.esds?.esd?.descs?.[0];
    const info = descriptor?.descs?.find((d) => d.tag === 5);
    return info?.data instanceof Uint8Array ? info.data : null;
  } catch {
    return null;
  }
};

const nextOffset = (offset: number, appended: number, suggested: number, size: number): number =>
  suggested > offset ? Math.min(suggested, size) : Math.min(offset + appended, size);

// Feeds chunks until mp4box has parsed `moov` (it may sit after a large mdat;
// appendBuffer's return value skips there directly).
const readMetadata = async (
  source: ByteSource,
  file: Mp4File,
): Promise<{ info: Mp4Info; offset: number } | null> => {
  let info: Mp4Info | null = null;
  let failed = false;
  file.onError = () => {
    failed = true;
  };
  file.onReady = (ready) => {
    info = ready;
  };
  let offset = 0;
  while (!info && !failed && offset < source.size) {
    const chunk = await source.read(offset, METADATA_CHUNK_BYTES);
    if (chunk.byteLength === 0) break;
    const suggested = file.appendBuffer(chunk, offset + chunk.byteLength >= source.size);
    offset = nextOffset(offset, chunk.byteLength, suggested, source.size);
  }
  return info ? { info, offset } : null;
};

export const remuxAudioTrack = async (source: ByteSource): Promise<RemuxedAudio | null> => {
  if (source.size === 0) return null;
  const MP4Box = await import("mp4box");
  quietMp4BoxLogs((MP4Box as unknown as { Log: Parameters<typeof quietMp4BoxLogs>[0] }).Log);
  const file = (MP4Box as unknown as { createFile: (keepMdat?: boolean) => Mp4File }).createFile(
    false,
  );

  let parsed: { info: Mp4Info; offset: number } | null;
  try {
    parsed = await readMetadata(source, file);
  } catch {
    return null;
  }
  const track = parsed?.info.audioTracks[0];
  if (!parsed || !track?.audio || !isAac(track.codec)) return null;
  const description = decoderSpecificInfo(file, track.id);
  if (!description) return null;

  const sampleRate = track.audio.sample_rate;
  const channelCount = track.audio.channel_count;
  const muxer = new Mp4Writer({
    audio: { codec: "aac", numberOfChannels: channelCount, sampleRate },
  });

  let sampleCount = 0;
  let failed = false;
  file.onError = () => {
    failed = true;
  };
  file.onSamples = (_id, _user, samples) => {
    for (const sample of samples) {
      if (!sample.data) continue;
      const toMicros = (units: number) => Math.round((units * 1_000_000) / sample.timescale);
      muxer.addAudioChunkRaw(
        sample.data,
        sample.is_sync ? "key" : "delta",
        toMicros(sample.cts),
        toMicros(sample.duration),
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
  };
  file.setExtractionOptions(track.id, null, { nbSamples: EXTRACTION_BATCH });
  file.start();

  // mp4box drops media payload it parsed before extraction started, so
  // re-read from the first sample's offset (the mdat, wherever it sits).
  let offset = Math.min(file.seekTrack(0, true, file.getTrackById(track.id)).offset, source.size);
  try {
    while (!failed && offset < source.size && sampleCount < track.nb_samples) {
      const chunk = await source.read(offset, SAMPLE_CHUNK_BYTES);
      if (chunk.byteLength === 0) break;
      const suggested = file.appendBuffer(chunk, offset + chunk.byteLength >= source.size);
      offset = nextOffset(offset, chunk.byteLength, suggested, source.size);
    }
    file.flush();
    file.stop();
  } catch {
    return null;
  }
  if (failed || sampleCount === 0) return null;

  const buffer = await muxer.finalize();
  return {
    blob: new Blob([buffer], { type: "audio/mp4" }),
    codec: track.codec,
    sampleRate,
    channelCount,
    sampleCount,
    durationMs: Math.round((track.duration * 1000) / track.timescale),
  };
};
