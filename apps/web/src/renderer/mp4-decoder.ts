// MP4 → encoded chunk → WebCodecs VideoDecoder pipeline for the playhead.
// Only the packets around the requested time are read from the source and
// decoded, so a large asset is never copied or decoded whole.

import { type RandomAccessMediaSource, clampReadRange } from "@/media/source/media-source";
import { type DemuxPacket, type OpenedMp4, openMp4 } from "./mp4-demux";
import type { VideoFrameCache } from "./video-frame-cache";

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

const FRAME_LOOK_BEHIND_US = 120_000;
const FRAME_LOOK_AHEAD_US = 650_000;
// B-frame reordering can place a wanted frame after later-decoded packets.
const REORDER_SLACK_US = 250_000;

export const frameDecodeWindow = (timestampUs: number): FrameDecodeWindow => ({
  startUs: Math.max(0, timestampUs - FRAME_LOOK_BEHIND_US),
  endUs: timestampUs + FRAME_LOOK_AHEAD_US,
});

const isMp4Available = (): boolean => typeof window !== "undefined" && "VideoDecoder" in window;

// The demuxer reads through this so a legacy OPFS Blob and a D1 media source
// (referenced file behind a ranged protocol) look the same to it.
export interface ByteSource {
  readonly size: number;
  read(start: number, length: number): Promise<ArrayBuffer>;
}

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
      if (range.length === 0) return new ArrayBuffer(0);
      return readRange(range.start, range.length);
    },
  };
};

const toChunk = (packet: DemuxPacket): EncodedVideoChunk =>
  new EncodedVideoChunk({
    type: packet.type,
    timestamp: packet.timestampUs,
    duration: packet.durationUs,
    data: packet.data,
  });

export const decodeMp4ToCache = async (
  input: Blob | RandomAccessMediaSource,
  assetId: string,
  cache: VideoFrameCache,
): Promise<DecoderHandle | null> => {
  const source = toByteSource(input);
  if (!isMp4Available() || source.size === 0) return null;

  const opened: OpenedMp4 | null = await openMp4(source);
  const track = opened?.videoTrack ?? null;
  const config = track?.config ?? null;
  if (!opened || !track || !config) {
    opened?.dispose();
    return null;
  }

  const support = await VideoDecoder.isConfigSupported(config).catch(() => null);
  if (support && support.supported === false) {
    opened.dispose();
    throw new UnsupportedCodecError(config.codec);
  }

  let closed = false;
  let generation = 0;
  let activeDecoder: VideoDecoder | null = null;
  let activeWindow: FrameDecodeWindow | null = null;
  let activeJob: Promise<void> | null = null;
  let queue = Promise.resolve();

  const decodeWindow = async (
    timestampUs: number,
    window: FrameDecodeWindow,
    requestGeneration: number,
  ): Promise<void> => {
    if (closed || requestGeneration !== generation) return;
    cache.forget(assetId);

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

    try {
      // From the key packet before the playhead through the end of the
      // window (plus reorder slack); frames outside the window are dropped
      // on output. Reads can fail (a drive that went away): that counts as
      // a decoder failure and the element fallback keeps the preview alive.
      let packet = await track.packets.keyPacketAt(timestampUs);
      while (packet && !closed && requestGeneration === generation) {
        if (packet.timestampUs > window.endUs + REORDER_SLACK_US) break;
        try {
          decoder.decode(toChunk(packet));
        } catch {
          // A corrupt packet should not poison the fallback video path.
        }
        packet = await track.packets.nextPacket(packet);
      }
      if (!closed && requestGeneration === generation) await decoder.flush();
    } catch (error) {
      decoderFailure = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (decoderFailure) cache.forget(assetId);
      if (activeDecoder === decoder) activeDecoder = null;
      try {
        decoder.close();
      } catch {
        // Already closed after a decoder error.
      }
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
    duration: opened.durationMs * 1000,
    width: track.codedWidth,
    height: track.codedHeight,
    request,
    close: () => {
      if (closed) return;
      closed = true;
      generation++;
      try {
        activeDecoder?.close();
      } catch {
        // Already closed after a decoder error.
      }
      activeDecoder = null;
      cache.forget(assetId);
      opened.dispose();
    },
  };
};
