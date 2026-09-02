// MP4 → encoded chunk → WebCodecs VideoDecoder pipeline. mp4box parses the
// container incrementally; only samples around the requested playhead are read
// from the source and decoded. This avoids copying and decoding the whole asset.

import { type RandomAccessMediaSource, clampReadRange } from "@/media/source/media-source";
import { primeMp4Box, serializeBoxPayload } from "./mp4-demux";
import { quietMp4BoxLogs } from "./mp4box-log";
import type { VideoFrameCache } from "./video-frame-cache";

interface MP4Sample {
  alreadyRead?: number;
  cts: number;
  duration: number;
  timescale: number;
  is_sync: boolean;
  number: number;
  data?: Uint8Array;
}

interface MP4TrackInfo {
  id: number;
  type?: string;
  codec: string;
  video?: { width: number; height: number };
}

interface MP4Info {
  duration: number;
  timescale: number;
  tracks: MP4TrackInfo[];
}

interface MP4File {
  onError: (error: string) => void;
  onReady: (info: MP4Info) => void;
  onSamples: (id: number, user: unknown, samples: MP4Sample[]) => void;
  setExtractionOptions: (
    id: number,
    user: unknown,
    options: { nbSamples: number; rapAlignement?: boolean },
  ) => void;
  unsetExtractionOptions: (id: number) => void;
  start: () => void;
  stop: () => void;
  seekTrack: (
    timeSeconds: number,
    useRap: boolean,
    track: unknown,
  ) => { offset: number; time: number };
  appendBuffer: (buffer: MP4ArrayBuffer, last?: boolean) => number;
  flush: () => void;
  getTrackById: (id: number) => unknown;
  releaseSample: (track: unknown, sampleNumber: number) => number;
}

type MP4ArrayBuffer = ArrayBuffer & { fileStart: number };

// Thrown when WebCodecs reports it cannot decode this stream (e.g. HEVC in a
// browser without a platform decoder). Callers stop retrying the asset.
export class UnsupportedCodecError extends Error {
  constructor(readonly codec: string) {
    super(`WebCodecs cannot decode ${codec} in this runtime`);
    this.name = "UnsupportedCodecError";
  }
}

export interface DecoderHandle {
  readonly assetId: string;
  readonly cache: VideoFrameCache;
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  request(timestampUs: number): Promise<void>;
  close(): void;
}

export interface FrameDecodeWindow {
  readonly startUs: number;
  readonly endUs: number;
}

const METADATA_CHUNK_BYTES = 512 * 1024;
const SAMPLE_CHUNK_BYTES = 1024 * 1024;
const SAMPLES_PER_BATCH = 8;
const FRAME_LOOK_BEHIND_US = 120_000;
const FRAME_LOOK_AHEAD_US = 650_000;

export const frameDecodeWindow = (timestampUs: number): FrameDecodeWindow => ({
  startUs: Math.max(0, timestampUs - FRAME_LOOK_BEHIND_US),
  endUs: timestampUs + FRAME_LOOK_AHEAD_US,
});

const isMp4Available = (): boolean => typeof window !== "undefined" && "VideoDecoder" in window;

// mp4box reads through this so a legacy OPFS Blob and a D1 media source
// (referenced file behind a ranged protocol) look the same to the demuxer.
export interface ByteSource {
  readonly size: number;
  read(start: number, length: number): Promise<MP4ArrayBuffer>;
}

const stamp = (buffer: ArrayBuffer, start: number): MP4ArrayBuffer => {
  const chunk = buffer as MP4ArrayBuffer;
  chunk.fileStart = start;
  return chunk;
};

export const toByteSource = (input: Blob | RandomAccessMediaSource): ByteSource => {
  const size = input instanceof Blob ? input.size : input.sizeBytes;
  const readRange =
    input instanceof Blob
      ? (start: number, length: number) => input.slice(start, start + length).arrayBuffer()
      : (start: number, length: number) => input.read(start, length);
  return {
    size,
    read: async (start, length) => {
      const range = clampReadRange(start, length, size);
      if (range.length === 0) return stamp(new ArrayBuffer(0), range.start);
      return stamp(await readRange(range.start, range.length), range.start);
    },
  };
};

const advanceOffset = (
  start: number,
  bytesRead: number,
  suggested: number,
  size: number,
): number => {
  const end = Math.min(size, start + bytesRead);
  return Number.isFinite(suggested) && suggested > end ? Math.min(size, suggested) : end;
};

const sampleToChunk = (sample: MP4Sample): EncodedVideoChunk | null => {
  if (!sample.data) return null;
  return new EncodedVideoChunk({
    type: sample.is_sync ? "key" : "delta",
    timestamp: (sample.cts * 1_000_000) / sample.timescale,
    duration: (sample.duration * 1_000_000) / sample.timescale,
    data: sample.data,
  });
};

// Best-effort AVC/HEVC decoder description. Some streams contain parameter
// sets in-band, so undefined remains a valid fallback.
const description = (file: MP4File, trackId: number): Uint8Array | undefined => {
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

const findVideoTrack = (info: MP4Info): MP4TrackInfo | null =>
  info.tracks.find((track) => track.type === "video" || track.video !== undefined) ?? null;

// Parse only enough of the source to discover `moov`. appendBuffer's suggested
// offset lets us jump over a large mdat box directly to a trailing moov.
const parseMetadata = async (source: ByteSource, file: MP4File): Promise<MP4Info | null> => {
  let info: MP4Info | null = null;
  let failure: Error | null = null;
  file.onReady = (ready) => {
    info = ready;
  };
  file.onError = (message) => {
    failure = new Error(`mp4box error: ${message}`);
  };

  let offset = 0;
  while (!info && !failure && offset < source.size) {
    const chunk = await source.read(offset, METADATA_CHUNK_BYTES);
    const suggested = file.appendBuffer(chunk, offset + chunk.byteLength >= source.size);
    offset = advanceOffset(offset, chunk.byteLength, suggested, source.size);
  }
  if (!info && !failure) file.flush();
  if (failure) throw failure;
  return info;
};

export const decodeMp4ToCache = async (
  input: Blob | RandomAccessMediaSource,
  assetId: string,
  cache: VideoFrameCache,
): Promise<DecoderHandle | null> => {
  const source = toByteSource(input);
  if (!isMp4Available() || source.size === 0) return null;

  const MP4Box = await import("mp4box");
  quietMp4BoxLogs((MP4Box as unknown as { Log: Parameters<typeof quietMp4BoxLogs>[0] }).Log);
  await primeMp4Box();
  // keepMdatData=false: mp4box discards media payload after sample extraction.
  const file = (
    MP4Box as unknown as { createFile: (keepMdatData?: boolean) => MP4File }
  ).createFile(false);
  const info = await parseMetadata(source, file);
  const track = info ? findVideoTrack(info) : null;
  if (!info || !track?.video) return null;

  const config: VideoDecoderConfig = {
    codec: track.codec,
    codedWidth: track.video.width,
    codedHeight: track.video.height,
    ...(() => {
      const value = description(file, track.id);
      return value ? { description: value } : {};
    })(),
  };

  const support = await VideoDecoder.isConfigSupported(config).catch(() => null);
  if (support && support.supported === false) throw new UnsupportedCodecError(track.codec);

  let closed = false;
  let generation = 0;
  let activeDecoder: VideoDecoder | null = null;
  let activeWindow: FrameDecodeWindow | null = null;
  let activeJob: Promise<void> | null = null;
  let queue = Promise.resolve();
  const trackBox = file.getTrackById(track.id);

  const decodeWindow = async (
    timestampUs: number,
    window: FrameDecodeWindow,
    requestGeneration: number,
  ): Promise<void> => {
    if (closed || requestGeneration !== generation) return;
    cache.forget(assetId);
    file.stop();
    try {
      file.unsetExtractionOptions(track.id);
    } catch {
      // No previous extraction registration.
    }

    try {
      activeDecoder?.close();
    } catch {
      // The decoder error callback may already have closed it.
    }
    let decoderFailure: Error | null = null;
    const decoder = new VideoDecoder({
      output: (frame) => {
        if (
          closed ||
          requestGeneration !== generation ||
          frame.timestamp < window.startUs ||
          frame.timestamp > window.endUs
        ) {
          frame.close();
          return;
        }
        cache.store(assetId, frame);
      },
      error: (error) => {
        decoderFailure = error instanceof Error ? error : new Error(String(error));
      },
    });
    activeDecoder = decoder;
    decoder.configure(config);

    let reachedWindowEnd = false;
    file.onSamples = (_id, _user, samples) => {
      if (closed || requestGeneration !== generation) return;
      for (const sample of samples) {
        const sampleTimestampUs = (sample.cts * 1_000_000) / sample.timescale;
        if (sampleTimestampUs > window.endUs) {
          reachedWindowEnd = true;
          file.stop();
          break;
        }
        const chunk = sampleToChunk(sample);
        if (chunk) {
          try {
            decoder.decode(chunk);
          } catch {
            // A corrupt sample should not poison the fallback video path.
          }
        }
        // releaseSample works for forward and backward seeks, unlike the
        // monotonic releaseUsedSamples helper.
        file.releaseSample(trackBox, sample.number);
      }
    };

    file.setExtractionOptions(track.id, null, {
      nbSamples: SAMPLES_PER_BATCH,
      rapAlignement: true,
    });
    const seek = file.seekTrack(Math.max(0, timestampUs) / 1_000_000, true, trackBox);
    let offset = Math.max(0, Math.floor(seek.offset));
    file.start();

    while (
      !closed &&
      requestGeneration === generation &&
      !reachedWindowEnd &&
      offset < source.size
    ) {
      const chunk = await source.read(offset, SAMPLE_CHUNK_BYTES);
      if (closed || requestGeneration !== generation) break;
      const suggested = file.appendBuffer(chunk, offset + chunk.byteLength >= source.size);
      offset = advanceOffset(offset, chunk.byteLength, suggested, source.size);
    }
    file.stop();
    file.unsetExtractionOptions(track.id);

    if (!closed && requestGeneration === generation) {
      try {
        await decoder.flush();
      } catch {
        // Decoder failures leave the HTMLVideoElement fallback in control.
      }
    }
    if (decoderFailure) cache.forget(assetId);
    if (activeDecoder === decoder) activeDecoder = null;
    try {
      decoder.close();
    } catch {
      // Already closed after a decoder error.
    }
  };

  const request = (timestampUs: number): Promise<void> => {
    if (closed) return Promise.resolve();
    if (
      activeJob &&
      activeWindow &&
      timestampUs >= activeWindow.startUs &&
      timestampUs <= activeWindow.endUs
    ) {
      return activeJob;
    }

    const requestGeneration = ++generation;
    const window = frameDecodeWindow(timestampUs);
    activeWindow = window;
    const job = queue
      .catch(() => {})
      .then(() => decodeWindow(timestampUs, window, requestGeneration))
      .finally(() => {
        if (activeJob === job) activeJob = null;
      });
    queue = job;
    activeJob = job;
    return job;
  };

  return {
    assetId,
    cache,
    duration: (info.duration * 1_000_000) / info.timescale,
    width: track.video.width,
    height: track.video.height,
    request,
    close: () => {
      if (closed) return;
      closed = true;
      generation++;
      file.stop();
      try {
        activeDecoder?.close();
      } catch {
        // Already closed after a decoder error.
      }
      activeDecoder = null;
      cache.forget(assetId);
    },
  };
};
