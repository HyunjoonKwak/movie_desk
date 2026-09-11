import type { ID } from "../utils/id";
import type { Fps, Ms } from "../utils/time";
import type { Clip } from "./clip";
import type { MediaCollection } from "./collection";
import type { Marker } from "./marker";
import type { MediaAsset } from "./media";
import type { Track } from "./track";

export interface Resolution {
  readonly w: number;
  readonly h: number;
}

export interface Timeline {
  readonly id: ID;
  /** Shown for a cut; a compound child is named by the clip that holds it. */
  readonly name?: string;
  /**
   * A cut is a top-level edit of this project's library. The root timeline
   * is always a cut; other cuts carry this role so they are never mistaken
   * for an orphaned compound child.
   */
  readonly role?: "cut";
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
  /** Unplaced clips retained by persistence; not playback edges. */
  readonly preservedClips?: readonly { readonly timelineId: string; readonly clip: Clip }[];
  readonly audio?: ProjectAudio;
  readonly id: ID;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly framerate: Fps;
  readonly resolution: Resolution;
  readonly timelines: readonly Timeline[];
  readonly rootTimelineId: ID;
  /** Derived root alias; use replaceTimeline/syncRootTimeline at write boundaries. */
  readonly timeline: Timeline;
  readonly mediaLibrary: readonly MediaAsset[];
  readonly collections?: readonly MediaCollection[]; // optional; older projects have none
}

export const PROJECT_VERSION = 2 as const;
