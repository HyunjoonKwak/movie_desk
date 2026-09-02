import type { MediaSourceState } from "@movie-desk/core";

// The one abstraction UI, decoders and exporters use to reach an asset's
// bytes. Adapters own where those bytes come from (OPFS copy today, a
// referenced file behind media:// on the desktop next); consumers never see
// paths or Node APIs. Reads are ranged so a 4K original is never copied whole.

export interface PlaybackLease {
  readonly url: string;
  release(): void;
}

export interface RandomAccessMediaSource {
  readonly assetId: string;
  readonly sizeBytes: number;
  readonly mime: string;
  read(start: number, length: number): Promise<ArrayBuffer>;
  acquirePlaybackUrl(): Promise<PlaybackLease>;
}

export class MediaSourceError extends Error {
  readonly state: MediaSourceState;

  constructor(state: MediaSourceState, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaSourceError";
    this.state = state;
  }
}

// One rule for every reader: negative or non-integer ranges are programmer
// errors and throw; ranges past the end clamp to empty. Callers check for a
// zero length before touching an adapter, so media:// never sees "bytes=n-(n-1)".
export const clampReadRange = (
  start: number,
  length: number,
  sizeBytes: number,
): { readonly start: number; readonly length: number } => {
  if (!Number.isSafeInteger(start) || start < 0) {
    throw new RangeError(`read start must be a non-negative integer, got ${start}`);
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError(`read length must be a non-negative integer, got ${length}`);
  }
  const from = Math.min(start, sizeBytes);
  return { start: from, length: Math.min(length, sizeBytes - from) };
};
