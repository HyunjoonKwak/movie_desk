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
