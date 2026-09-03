import { type FrameVerdict, createFrameDelivery } from "./frame-delivery";
import {
  type Mp4Sample,
  type OpenedMp4,
  nextAppendOffset,
  presentationOffsetMs,
  videoDecoderConfig,
} from "./mp4-demux";

// Decodes windows of a video track in presentation order with one WebCodecs
// decoder. Analysis (scene cuts, motion, auto-edit sampling) used to seek a
// media element frame by frame; a linear pass through the demuxer is what
// the hardware decoder is built for. Each run starts at the keyframe before
// `fromMs`, reads only the bytes its samples occupy, and ends with a flush so
// the next run can begin at another keyframe on the same decoder.
//
// Timestamps given to `onFrame` are presentation time in microseconds (the
// container's edit-list delay removed), so they line up with what a media
// element shows at the same time.

export type LinearDecodeResult = "done" | "stopped" | "unsupported" | "failed";

export interface DecodeRun {
  readonly fromMs: number;
  readonly toMs: number;
}

export type { FrameVerdict } from "./frame-delivery";

export interface LinearDecodeOptions {
  readonly signal?: AbortSignal;
  // Owns the frame: must close it (or keep it) and say whether the run is
  // done. May answer asynchronously; frames are handed over one at a time
  // and feeding pauses until pending answers settle, so a slow consumer
  // throttles the decoder instead of piling up frames. Throwing or rejecting
  // fails the pass and the frame is closed for it.
  readonly onFrame: (
    frame: VideoFrame,
    runIndex: number,
  ) => FrameVerdict | PromiseLike<FrameVerdict>;
}

const READ_CHUNK_BYTES = 1024 * 1024;
const MAX_QUEUE = 16;
// B-frame reordering can put a wanted frame after later-decoded samples.
const REORDER_SLACK_US = 1_000_000;

// Construction itself can throw (no hardware decoder, sandboxed runtime).
const createDecoder = (
  output: (frame: VideoFrame) => void,
  error: () => void,
): VideoDecoder | null => {
  try {
    return new VideoDecoder({ output, error });
  } catch {
    return null;
  }
};

const waitForQueue = async (decoder: VideoDecoder): Promise<void> => {
  while (decoder.decodeQueueSize > MAX_QUEUE) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

interface SampleEntry {
  readonly cts: number;
  readonly timescale: number;
  readonly offset: number;
  readonly size: number;
}

// Last byte needed for a run: the end of the latest sample whose media time
// is within the run (plus reorder slack). Falls back to the file end.
const runEndOffset = (
  samples: readonly SampleEntry[],
  startOffset: number,
  mediaToUs: number,
  fileSize: number,
): number => {
  let end = startOffset;
  for (const sample of samples) {
    if (sample.offset < startOffset) continue;
    if ((sample.cts * 1_000_000) / sample.timescale > mediaToUs + REORDER_SLACK_US) break;
    end = Math.max(end, sample.offset + sample.size);
  }
  return end > startOffset ? Math.min(end, fileSize) : fileSize;
};

export const decodeRunsInOrder = async (
  opened: OpenedMp4,
  runs: readonly DecodeRun[],
  options: LinearDecodeOptions,
): Promise<LinearDecodeResult> => {
  if (typeof VideoDecoder === "undefined") return "unsupported";
  const config = videoDecoderConfig(opened);
  const track = opened.videoTrack;
  if (!config || !track) return "unsupported";
  const support = await VideoDecoder.isConfigSupported(config).catch(() => null);
  if (support && support.supported === false) return "unsupported";

  const { file, source } = opened;
  const trak = file.getTrackById(track.id) as { samples?: readonly SampleEntry[] };
  const sampleTable = trak.samples ?? [];
  const offsetUs = presentationOffsetMs(opened) * 1000;
  const presentationUs = (sample: Mp4Sample): number =>
    Math.round((sample.cts * 1_000_000) / sample.timescale - offsetUs);

  // Input and output are decoupled: the reorder limit only stops feeding,
  // while outputs stay open until the caller has what it wanted or the run
  // has been flushed. A shared `activeRun` is safe because flush() resolves
  // only after every frame of the run has been emitted.
  let activeRun = -1;
  let outputsOpen = false;
  let feeding = false;
  let failed = false;
  const stopRun = () => {
    outputsOpen = false;
    feeding = false;
  };
  // Every frame goes through this chain; feeding waits on it, so the sink
  // never sees two frames at once and a slow answer holds the decoder back.
  const delivery = createFrameDelivery<VideoFrame>(options.onFrame, {
    isOpen: () => outputsOpen,
    onStop: stopRun,
    onFailure: () => {
      failed = true;
      stopRun();
    },
  });
  const decoder = createDecoder(
    (frame) => delivery.deliver(frame, activeRun),
    () => {
      failed = true;
      stopRun();
    },
  );
  if (!decoder) return "unsupported";
  try {
    decoder.configure(config);
  } catch {
    // The runtime rejected the codec/description despite isConfigSupported.
    decoder.close();
    return "unsupported";
  }

  const pending: Mp4Sample[] = [];
  file.onSamples = (_id, _user, samples) => {
    pending.push(...samples);
  };

  const isAborted = (): boolean => options.signal?.aborted === true;

  const feed = async (toUs: number): Promise<void> => {
    while (pending.length > 0 && feeding && !isAborted()) {
      const sample = pending.shift() as Mp4Sample;
      if (!sample.data) continue;
      const timestamp = presentationUs(sample);
      if (timestamp > toUs + REORDER_SLACK_US) {
        feeding = false;
        break;
      }
      decoder.decode(
        new EncodedVideoChunk({
          type: sample.is_sync ? "key" : "delta",
          timestamp,
          duration: (sample.duration * 1_000_000) / sample.timescale,
          data: sample.data,
        }),
      );
      await waitForQueue(decoder);
      await delivery.drain();
    }
  };

  // Resolves to whether the run was cut short by the abort signal.
  const decodeRun = async (index: number, run: DecodeRun): Promise<boolean> => {
    activeRun = index;
    outputsOpen = true;
    feeding = true;
    pending.length = 0;
    file.stop();
    file.setExtractionOptions(track.id, null, { nbSamples: 32, rapAlignement: true });
    const seek = file.seekTrack(
      Math.max(0, (run.fromMs * 1000 + offsetUs) / 1_000_000),
      true,
      file.getTrackById(track.id),
    );
    file.start();
    const toUs = run.toMs * 1000;
    let offset = Math.min(seek.offset, source.size);
    const end = runEndOffset(sampleTable, offset, toUs + offsetUs, source.size);
    try {
      while (feeding && offset < end && !isAborted()) {
        const chunk = await source.read(offset, Math.min(READ_CHUNK_BYTES, end - offset));
        if (chunk.byteLength === 0) break;
        const suggested = file.appendBuffer(chunk, offset + chunk.byteLength >= source.size);
        offset = nextAppendOffset(offset, chunk.byteLength, suggested, source.size);
        await feed(toUs);
      }
      if (feeding && !isAborted() && end >= source.size) {
        file.flush();
        await feed(toUs);
      }
    } finally {
      file.stop();
      try {
        file.unsetExtractionOptions(track.id);
      } catch {
        // Already unset by a stop.
      }
    }
    // Emit what the decoder still holds; also resets it for the next keyframe.
    // An aborted run skips this: closing the decoder drops those frames.
    const aborted = isAborted();
    if (!failed && !aborted) await decoder.flush().catch(() => undefined);
    // Frames already queued for the sink are handed over or closed before the
    // run ends, so none outlives its run or reaches the next one.
    await delivery.drain();
    outputsOpen = false;
    return aborted;
  };

  let stoppedEarly = false;
  try {
    for (const [index, run] of runs.entries()) {
      if (options.signal?.aborted) {
        stoppedEarly = true;
        break;
      }
      if (await decodeRun(index, run)) {
        stoppedEarly = true;
        break;
      }
      if (failed) break;
    }
  } catch {
    failed = true;
  } finally {
    outputsOpen = false;
    try {
      decoder.close();
    } catch {
      // Closed after an error.
    }
  }
  if (failed) return "failed";
  return stoppedEarly ? "stopped" : "done";
};
