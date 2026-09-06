import type { ID } from "../utils/id";
import type { Ms, Fps } from "../utils/time";
import type { MediaCollection } from "./collection";
import type { MediaAsset } from "./media";
import type { Marker } from "./marker";
import type { Track } from "./track";

export interface Resolution {
  readonly w: number;
  readonly h: number;
}

export interface Timeline {
  readonly tracks: readonly Track[];
  readonly playhead: Ms;
  readonly zoom: number; // pixels per ms
  readonly duration: Ms; // computed cap; engine recomputes on edits
  readonly markers?: readonly Marker[]; // optional; backwards compatible
}

export interface AudioBus {
  readonly id: string;
  readonly name: string;
  readonly gainDb: number;
  readonly muted?: boolean;
}

export interface ProjectAudio {
  readonly buses: readonly AudioBus[];
  readonly master: { readonly gainDb: number };
}

export interface Project {
  readonly audio?: ProjectAudio;
  readonly id: ID;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly framerate: Fps;
  readonly resolution: Resolution;
  readonly timeline: Timeline;
  readonly mediaLibrary: readonly MediaAsset[];
  readonly collections?: readonly MediaCollection[]; // optional; older projects have none
}

export const PROJECT_VERSION = 1 as const;
