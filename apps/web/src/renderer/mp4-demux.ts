import type { ByteSource } from "./mp4-decoder";
import { quietMp4BoxLogs } from "./mp4box-log";

// Shared mp4box entry point: parse the metadata window of an ISO BMFF file
// (MP4, QuickTime .mov) through a ByteSource and expose what WebCodecs needs
// to configure a decoder. Consumers feed the sample data themselves.

export interface Mp4Sample {
  readonly cts: number;
  readonly dts: number;
  readonly duration: number;
  readonly timescale: number;
  readonly is_sync: boolean;
  readonly number: number;
  readonly data?: Uint8Array;
}

interface Mp4TrackInfo {
  readonly id: number;
  readonly type?: string;
  readonly codec: string;
  readonly timescale: number;
  readonly duration: number;
  readonly nb_samples: number;
  readonly video?: { readonly width: number; readonly height: number };
  readonly audio?: { readonly sample_rate: number; readonly channel_count: number };
}

interface Mp4Info {
  readonly duration: number;
  readonly timescale: number;
  readonly brands: readonly string[];
  readonly videoTracks: readonly Mp4TrackInfo[];
  readonly audioTracks: readonly Mp4TrackInfo[];
}

type Mp4ArrayBuffer = ArrayBuffer & { fileStart: number };

interface Mp4File {
  onError: (error: string) => void;
  onReady: (info: Mp4Info) => void;
  onSamples: (id: number, user: unknown, samples: readonly Mp4Sample[]) => void;
  setExtractionOptions: (
    id: number,
    user: unknown,
    options: { nbSamples: number; rapAlignement?: boolean },
  ) => void;
  unsetExtractionOptions: (id: number) => void;
  start: () => void;
  stop: () => void;
  flush: () => void;
  seekTrack: (timeSeconds: number, useRap: boolean, track: unknown) => { offset: number };
  appendBuffer: (buffer: Mp4ArrayBuffer, last?: boolean) => number;
  getTrackById: (id: number) => unknown;
}

export interface OpenedMp4 {
  readonly source: ByteSource;
  readonly file: Mp4File;
  readonly info: Mp4Info;
  readonly videoTrack: Mp4TrackInfo | null;
  readonly durationMs: number;
}

const METADATA_CHUNK_BYTES = 1 * 1024 * 1024;

export const nextAppendOffset = (
  offset: number,
  appended: number,
  suggested: number,
  size: number,
): number => (suggested > offset ? Math.min(suggested, size) : Math.min(offset + appended, size));

interface Mp4BoxModule {
  createFile: (keepMdat?: boolean) => Mp4File;
  Log: Parameters<typeof quietMp4BoxLogs>[0];
  DataStream: new (
    buffer: ArrayBuffer | undefined,
    byteOffset: number,
    endianness: boolean,
  ) => { buffer: ArrayBuffer; getPosition: () => number };
}

let mp4box: Mp4BoxModule | null = null;

const loadMp4Box = async (): Promise<Mp4BoxModule> => {
  if (mp4box) return mp4box;
  const module = (await import("mp4box")) as unknown as Mp4BoxModule & {
    DataStream: Mp4BoxModule["DataStream"] & { BIG_ENDIAN: boolean };
  };
  quietMp4BoxLogs(module.Log);
  mp4box = module;
  return module;
};

// Loads and quiets mp4box once so serializeBoxPayload has its DataStream.
export const primeMp4Box = async (): Promise<void> => {
  await loadMp4Box();
};

// mp4box parses avcC/hvcC into fields and keeps no raw copy, so the record
// WebCodecs wants as `description` is rebuilt by serialising the box and
// dropping its 8-byte header.
export const serializeBoxPayload = (box: unknown): Uint8Array | undefined => {
  const module = mp4box as (Mp4BoxModule & { DataStream: { BIG_ENDIAN: boolean } }) | null;
  const writable = box as { write?: (stream: unknown) => void } | null;
  if (!module || !writable || typeof writable.write !== "function") return undefined;
  const stream = new module.DataStream(undefined, 0, module.DataStream.BIG_ENDIAN);
  writable.write(stream);
  const length = stream.getPosition() - 8;
  return length > 0 ? new Uint8Array(stream.buffer, 8, length).slice() : undefined;
};

// Reads chunks until mp4box has parsed `moov`; appendBuffer's return value
// jumps over a large mdat when the index sits at the end of the file.
export const openMp4 = async (source: ByteSource): Promise<OpenedMp4 | null> => {
  if (source.size === 0) return null;
  const MP4Box = await loadMp4Box();
  const file = MP4Box.createFile(false);
  const state: { info: Mp4Info | null; failed: boolean } = { info: null, failed: false };
  file.onError = () => {
    state.failed = true;
  };
  file.onReady = (ready) => {
    state.info = ready;
  };
  let offset = 0;
  try {
    while (!state.info && !state.failed && offset < source.size) {
      const chunk = await source.read(offset, METADATA_CHUNK_BYTES);
      if (chunk.byteLength === 0) break;
      const suggested = file.appendBuffer(chunk, offset + chunk.byteLength >= source.size);
      offset = nextAppendOffset(offset, chunk.byteLength, suggested, source.size);
    }
  } catch {
    return null;
  }
  const ready = state.info;
  if (!ready) return null;
  const videoTrack = ready.videoTracks.find((t) => t.video) ?? null;
  return {
    source,
    file,
    info: ready,
    videoTrack,
    durationMs: ready.timescale > 0 ? (ready.duration * 1000) / ready.timescale : 0,
  };
};

// avcC / hvcC bytes from the sample description; some streams carry their
// parameter sets in-band, so undefined stays valid.
const decoderDescription = (file: Mp4File, trackId: number): Uint8Array | undefined => {
  try {
    const trak = file.getTrackById(trackId) as {
      mdia?: { minf?: { stbl?: { stsd?: { entries?: { avcC?: unknown; hvcC?: unknown }[] } } } };
    };
    const entry = trak.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const box = entry?.avcC ?? entry?.hvcC;
    return box ? serializeBoxPayload(box) : undefined;
  } catch {
    return undefined;
  }
};

export const videoDecoderConfig = (opened: OpenedMp4): VideoDecoderConfig | null => {
  const track = opened.videoTrack;
  if (!track?.video) return null;
  const description = decoderDescription(opened.file, track.id);
  return {
    codec: track.codec,
    codedWidth: track.video.width,
    codedHeight: track.video.height,
    ...(description ? { description } : {}),
  };
};
