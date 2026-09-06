import type { ID } from "../utils/id";
import type { Clip } from "./clip";

export type TrackKind = "video" | "audio" | "text" | "overlay";

export interface TrackAudio {
  readonly gainDb?: number;
  readonly pan?: number;
  readonly busId?: string;
}

export interface Track {
  readonly audio?: TrackAudio;
  readonly id: ID;
  readonly kind: TrackKind;
  readonly name: string;
  readonly height: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly locked: boolean;
  // FCP-style connected lane (Q): sits above the primary track of its kind
  // (earlier array index composites on top) and is skipped when three-point
  // edits pick their target track. Absent = a primary/storyline track.
  readonly connected?: boolean;
  readonly clips: readonly Clip[];
}
