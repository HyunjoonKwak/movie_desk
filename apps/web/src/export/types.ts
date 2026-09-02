import type { ID } from "@movie-desk/core";

type Container = "mp4" | "webm";
type VideoCodec = "h264" | "vp9" | "av1";
type AudioCodec = "aac" | "opus";

export interface ExportPreset {
  readonly id: string;
  readonly name: string;
  readonly container: Container;
  readonly videoCodec: VideoCodec;
  readonly audioCodec: AudioCodec;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly videoBitrateKbps: number;
  readonly audioBitrateKbps: number;
}

export interface ExportRequest {
  readonly projectId: ID;
  readonly preset: ExportPreset;
}

export interface ExportProgress {
  readonly stage: "preparing" | "rendering" | "muxing" | "finalizing";
  readonly progress: number; // 0..1
  readonly fps?: number; // realised render fps
  readonly etaSeconds?: number; // rough estimate remaining
}

export interface ExportResult {
  readonly blob: Blob;
  readonly mime: string;
  readonly suggestedName: string;
}

export interface Exporter {
  start(req: ExportRequest, onProgress: (p: ExportProgress) => void): Promise<ExportResult>;
  cancel(): void;
}
