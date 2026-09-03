import type { RandomAccessMediaSource } from "@/media/source/media-source";
import type { SourceRotation } from "@movie-desk/core";
import { decodeRunsInOrder } from "./linear-decoder";
import { type ByteSource, toByteSource } from "./mp4-decoder";
import { type OpenedMp4, openMp4, syncSampleTimesMs } from "./mp4-demux";

// One frame sampler for every analysis pass. Requested times are grouped into
// runs, each run is decoded once in order with WebCodecs, and every request
// is served by the first frame at or after it. Non-MP4 sources and codecs the
// runtime cannot decode fall back to seeking a media element. Frames stream
// to the caller one at a time; only `sampleFramesAt` keeps them all.

interface FrameSampleSize {
  readonly width: number;
  readonly height: number;
}

export interface SampledImage {
  readonly atMs: number;
  readonly image: ImageData;
}

export interface FrameSampleOptions {
  readonly size: FrameSampleSize | ((sourceWidth: number, sourceHeight: number) => FrameSampleSize);
  // Container rotation of the source; WebCodecs frames come back unrotated.
  readonly rotation?: SourceRotation;
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
  // Gap between two requests beyond which the decoder re-seeks instead of
  // decoding straight through.
  readonly gapMs?: number;
}

export type SampleTimes = readonly number[] | ((durationMs: number) => readonly number[]);

// Receives frames in time order. Copy what you need: the ImageData is the
// caller's to keep or drop.
export type SampleSink = (sample: SampledImage) => void;

const DEFAULT_GAP_MS = 2500;

const sortedUnique = (timesMs: readonly number[]): number[] =>
  [...new Set(timesMs.map((t) => Math.max(0, t)))].sort((a, b) => a - b);

// Groups requests into runs the decoder plays straight through. A run only
// breaks where seeking would skip at least one whole GOP: with two or more
// keyframes between consecutive requests, the frames of the GOPs in between
// are never needed, so the decoder jumps ahead. One intervening keyframe is
// decoded through instead — a flush/seek costs about as much as the handful
// of frames it would skip, and a single linear pass keeps the hardware
// decoder streaming. Without keyframes, `gapMs` bounds how far to decode
// through.
export const planSampleRuns = (
  timesMs: readonly number[],
  gapMs: number,
  keyframesMs: readonly number[] = [],
): number[][] => {
  const keyframes = [...keyframesMs].sort((a, b) => a - b);
  let keyframeIndex = 0;
  const keyframesBetween = (fromMs: number, toMs: number): number => {
    while (keyframeIndex < keyframes.length && (keyframes[keyframeIndex] as number) <= fromMs) {
      keyframeIndex += 1;
    }
    let count = 0;
    for (let i = keyframeIndex; i < keyframes.length && (keyframes[i] as number) <= toMs; i += 1) {
      count += 1;
    }
    return count;
  };
  const runs: number[][] = [];
  for (const t of sortedUnique(timesMs)) {
    const current = runs[runs.length - 1];
    const previous = current?.[current.length - 1];
    const continues =
      previous !== undefined &&
      (keyframes.length > 0 ? keyframesBetween(previous, t) < 2 : t - previous <= gapMs);
    if (current && continues) current.push(t);
    else runs.push([t]);
  }
  return runs;
};

// Times not yet served, for a fallback that continues where WebCodecs left off.
export const remainingTimes = (
  requested: readonly number[],
  served: ReadonlySet<number>,
): number[] => sortedUnique(requested).filter((t) => !served.has(t));

interface PickedFrames {
  // Requests answered by the frame shown before this one (it was still on
  // screen at their time) and by this frame itself.
  readonly byPrevious: number[];
  readonly byCurrent: number[];
}

export interface SamplePicker {
  // Feed frames in presentation order; each request is served by the frame
  // displayed at its time, the way a media element seek would show it.
  take(frameUs: number): PickedFrames;
  remaining(): number[];
  readonly done: boolean;
}

export const createSamplePicker = (timesMs: readonly number[]): SamplePicker => {
  const pending = sortedUnique(timesMs);
  let index = 0;
  let hasPrevious = false;
  return {
    take: (frameUs) => {
      const frameMs = frameUs / 1000;
      const byPrevious: number[] = [];
      const byCurrent: number[] = [];
      while (index < pending.length) {
        const t = pending[index] as number;
        if (t < frameMs - 0.5) (hasPrevious ? byPrevious : byCurrent).push(t);
        else if (t <= frameMs + 0.5) byCurrent.push(t);
        else break;
        index += 1;
      }
      hasPrevious = true;
      return { byPrevious, byCurrent };
    },
    remaining: () => pending.slice(index),
    get done() {
      return index >= pending.length;
    },
  };
};

const createCanvas = (size: FrameSampleSize) => {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable for frame sampling");
  return ctx;
};

const resolveSize = (
  option: FrameSampleOptions["size"],
  sourceWidth: number,
  sourceHeight: number,
): FrameSampleSize => (typeof option === "function" ? option(sourceWidth, sourceHeight) : option);

// Draws an unrotated decoded frame so the canvas shows it upright.
const drawRotated = (
  ctx: CanvasRenderingContext2D,
  frame: CanvasImageSource,
  rotation: SourceRotation,
  width: number,
  height: number,
): void => {
  ctx.save();
  switch (rotation) {
    case 90:
      ctx.translate(width, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(frame, 0, 0, height, width);
      break;
    case 180:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      ctx.drawImage(frame, 0, 0, width, height);
      break;
    case 270:
      ctx.translate(0, height);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(frame, 0, 0, height, width);
      break;
    default:
      ctx.drawImage(frame, 0, 0, width, height);
  }
  ctx.restore();
};

// Returns the times that were served. Times still missing (decode failure
// mid-way, unsupported codec) are the fallback's job.
const sampleViaWebCodecs = async (
  opened: OpenedMp4,
  timesMs: readonly number[],
  options: FrameSampleOptions,
  emit: SampleSink,
): Promise<ReadonlySet<number>> => {
  const served = new Set<number>();
  const video = opened.videoTrack?.video;
  if (!video) return served;
  const rotation = options.rotation ?? 0;
  const swapped = rotation === 90 || rotation === 270;
  const size = resolveSize(
    options.size,
    swapped ? video.height : video.width,
    swapped ? video.width : video.height,
  );
  const ctx = createCanvas(size);
  const total = sortedUnique(timesMs).length;
  const last: { frame: VideoFrame | null } = { frame: null };

  const deliver = (frame: VideoFrame, atMsList: readonly number[]): void => {
    drawRotated(ctx, frame, rotation, size.width, size.height);
    const image = ctx.getImageData(0, 0, size.width, size.height);
    for (const atMs of atMsList) {
      served.add(atMs);
      emit({ atMs, image });
    }
    options.onProgress?.(served.size, total);
  };

  const keyframes = syncSampleTimesMs(opened);
  const runs = planSampleRuns(timesMs, options.gapMs ?? DEFAULT_GAP_MS, keyframes);
  const pickers = runs.map((run) => createSamplePicker(run));
  const finishRun = (runIndex: number): void => {
    // Requests past the last decoded frame (end of file) get that frame.
    const pending = pickers[runIndex]?.remaining() ?? [];
    if (pending.length > 0 && last.frame && !options.signal?.aborted) deliver(last.frame, pending);
    last.frame?.close();
    last.frame = null;
  };
  let currentRun = -1;
  await decodeRunsInOrder(
    opened,
    runs.map((run) => ({
      fromMs: Math.max(0, (run[0] as number) - 40),
      toMs: run[run.length - 1] as number,
    })),
    {
      ...(options.signal ? { signal: options.signal } : {}),
      onFrame: (frame, runIndex) => {
        if (runIndex !== currentRun) {
          if (currentRun >= 0) finishRun(currentRun);
          currentRun = runIndex;
        }
        const picker = pickers[runIndex] as SamplePicker;
        const picked = picker.take(frame.timestamp);
        if (picked.byPrevious.length > 0) deliver(last.frame ?? frame, picked.byPrevious);
        if (picked.byCurrent.length > 0) deliver(frame, picked.byCurrent);
        last.frame?.close();
        last.frame = frame;
        return picker.done ? "stop" : "continue";
      },
    },
  );
  if (currentRun >= 0) finishRun(currentRun);
  last.frame?.close();
  return served;
};

const loadVideo = (url: string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const element = document.createElement("video");
    element.crossOrigin = "anonymous";
    element.preload = "auto";
    element.muted = true;
    element.playsInline = true;
    const cleanup = () => {
      element.removeEventListener("loadedmetadata", onMeta);
      element.removeEventListener("error", onError);
    };
    const onMeta = () => {
      cleanup();
      resolve(element);
    };
    const onError = () => {
      cleanup();
      reject(new Error("video metadata load failed"));
    };
    element.addEventListener("loadedmetadata", onMeta);
    element.addEventListener("error", onError);
    element.src = url;
  });

const seekTo = (element: HTMLVideoElement, seconds: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener("seeked", onSeeked);
      element.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("seek failed"));
    };
    element.addEventListener("seeked", onSeeked);
    element.addEventListener("error", onError);
    element.currentTime = seconds;
  });

const sampleViaElement = async (
  input: Blob | RandomAccessMediaSource,
  times: SampleTimes,
  options: FrameSampleOptions,
  emit: SampleSink,
): Promise<void> => {
  const lease =
    input instanceof Blob
      ? { url: URL.createObjectURL(input), release: () => URL.revokeObjectURL(lease.url) }
      : await input.acquirePlaybackUrl();
  try {
    const element = await loadVideo(lease.url);
    try {
      const durationMs = Number.isFinite(element.duration) ? element.duration * 1000 : 0;
      const requested = sortedUnique(typeof times === "function" ? times(durationMs) : times);
      const size = resolveSize(options.size, element.videoWidth, element.videoHeight);
      const ctx = createCanvas(size);
      let done = 0;
      for (const atMs of requested) {
        if (options.signal?.aborted) break;
        await seekTo(element, atMs / 1000);
        ctx.drawImage(element, 0, 0, size.width, size.height);
        emit({ atMs, image: ctx.getImageData(0, 0, size.width, size.height) });
        done += 1;
        options.onProgress?.(done, requested.length);
      }
    } finally {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
  } finally {
    lease.release();
  }
};

// Streams every requested frame to `emit`, in time order, holding at most one
// decoded frame at a time. Stops quietly when `signal` aborts.
export const streamFramesAt = async (
  input: Blob | RandomAccessMediaSource,
  times: SampleTimes,
  options: FrameSampleOptions,
  emit: SampleSink,
): Promise<void> => {
  let remaining: SampleTimes = times;
  if (typeof VideoDecoder !== "undefined") {
    const source: ByteSource = toByteSource(input);
    const opened = await openMp4(source);
    if (opened?.videoTrack) {
      const requested = typeof times === "function" ? times(opened.durationMs) : times;
      if (requested.length === 0) return;
      const served = await sampleViaWebCodecs(opened, requested, options, emit);
      remaining = remainingTimes(requested, served);
      if (remaining.length === 0 || options.signal?.aborted) return;
    }
  }
  await sampleViaElement(input, remaining, options, emit);
};

export const sampleFramesAt = async (
  input: Blob | RandomAccessMediaSource,
  times: SampleTimes,
  options: FrameSampleOptions,
): Promise<readonly SampledImage[]> => {
  const out: SampledImage[] = [];
  await streamFramesAt(input, times, options, (sample) => out.push(sample));
  return out;
};
