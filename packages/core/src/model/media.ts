import type { ID } from "../utils/id";
import type { Ms } from "../utils/time";
import type { SourceRef } from "./media-source";

export type MediaKind = "video" | "audio" | "image";

export interface MediaAsset {
  readonly id: ID;
  readonly name: string;
  readonly kind: MediaKind;
  readonly mime: string;
  readonly durationMs: Ms;
  readonly width?: number;
  readonly height?: number;
  readonly opfsPath: string;       // key into OPFS file store (full-res original)
  readonly sourceRef?: SourceRef;  // D1: where the bytes live; absent = legacy OPFS copy
  readonly sizeBytes?: number;     // full-res byte length; lets a peer detect an
                                   // incomplete/partial OPFS file (e.g. a media
                                   // transfer interrupted by a crash) instead of
                                   // trusting mere existence
  readonly proxyPath?: string;     // optional low-res proxy in OPFS
  readonly proxyWidth?: number;    // proxy resolution
  readonly proxyHeight?: number;
  readonly thumbDataUrl?: string;  // small preview for media bin
  readonly capturedAt?: number;    // capture time (EXIF DateTimeOriginal / mvhd
                                   // creation_time), epoch ms; import falls back
                                   // to File.lastModified when absent
  readonly gpsLat?: number;        // capture GPS, decimal degrees (EXIF / ISO6709)
  readonly gpsLon?: number;
  readonly useInMs?: Ms;           // user-marked usable range within the source —
  readonly useOutMs?: Ms;          // auto-edit candidates and timeline adds respect it
  readonly filmstripDataUrl?: string; // wide multi-frame strip over full source
  readonly filmstripFrames?: number;  // number of frames in the strip
  readonly waveformPeaks?: readonly number[]; // downsampled abs-max peaks
  readonly importedAt: number;
}
