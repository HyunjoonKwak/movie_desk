import type { Ms } from "@movie-desk/core";

export interface Subtitle {
  readonly start: Ms;
  readonly end: Ms;
  readonly text: string;
  readonly lang?: string;
  readonly confidence?: number;
}

export interface Range {
  readonly start: Ms;
  readonly end: Ms;
}

export interface SceneCut {
  readonly atMs: Ms;
  readonly score: number;
}
