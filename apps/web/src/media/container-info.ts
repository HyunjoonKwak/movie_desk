import type { RandomAccessMediaSource } from "@/media/source/media-source";
import { type ByteSource, toByteSource } from "@/renderer/mp4-decoder";
import { quietMp4BoxLogs } from "@/renderer/mp4box-log";
import type { SourceRotation } from "@movie-desk/core";
import { rotationFromMatrix } from "@movie-desk/core";

// What import learns from an ISO BMFF container (MP4, QuickTime .mov)
// before anything is decoded: codec strings, the display rotation, and
// whether an audio track exists. Reads only the metadata window.

export interface Mp4ContainerInfo {
  readonly brands: readonly string[];
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly rotation: SourceRotation;
  readonly width: number | null;
  readonly height: number | null;
}

interface Mp4Track {
  readonly id: number;
  readonly codec: string;
  readonly video?: { readonly width: number; readonly height: number };
}

interface Mp4Info {
  readonly brands: readonly string[];
  readonly videoTracks: readonly Mp4Track[];
  readonly audioTracks: readonly Mp4Track[];
}

type Mp4ArrayBuffer = ArrayBuffer & { fileStart: number };

interface Mp4File {
  onError: (error: string) => void;
  onReady: (info: Mp4Info) => void;
  appendBuffer: (buffer: Mp4ArrayBuffer, last?: boolean) => number;
  getTrackById: (id: number) => unknown;
}

interface Mp4Module {
  createFile: (keepMdat?: boolean) => Mp4File;
  Log: Parameters<typeof quietMp4BoxLogs>[0];
}

const METADATA_CHUNK_BYTES = 1 * 1024 * 1024;

const loadMp4Box = async (): Promise<Mp4Module> => {
  const module = (await import("mp4box")) as unknown as Mp4Module;
  quietMp4BoxLogs(module.Log);
  return module;
};

const trackMatrix = (file: Mp4File, trackId: number): ArrayLike<number> | null => {
  try {
    const trak = file.getTrackById(trackId) as { tkhd?: { matrix?: ArrayLike<number> } };
    return trak.tkhd?.matrix ?? null;
  } catch {
    return null;
  }
};

const readMetadata = async (source: ByteSource, file: Mp4File): Promise<Mp4Info | null> => {
  let info: Mp4Info | null = null;
  let failed = false;
  file.onError = () => {
    failed = true;
  };
  file.onReady = (ready) => {
    info = ready;
  };
  let offset = 0;
  while (!info && !failed && offset < source.size) {
    const chunk = await source.read(offset, METADATA_CHUNK_BYTES);
    if (chunk.byteLength === 0) break;
    const suggested = file.appendBuffer(chunk, offset + chunk.byteLength >= source.size);
    offset = suggested > offset ? Math.min(suggested, source.size) : offset + chunk.byteLength;
  }
  return info;
};

export const readMp4ContainerInfo = async (
  input: Blob | RandomAccessMediaSource,
): Promise<Mp4ContainerInfo | null> => {
  const source = toByteSource(input);
  if (source.size === 0) return null;
  const MP4Box = await loadMp4Box();
  const file = MP4Box.createFile(false);
  let info: Mp4Info | null;
  try {
    info = await readMetadata(source, file);
  } catch {
    return null;
  }
  if (!info) return null;
  const video = info.videoTracks[0] ?? null;
  const audio = info.audioTracks[0] ?? null;
  const matrix = video ? trackMatrix(file, video.id) : null;
  return {
    brands: info.brands,
    videoCodec: video?.codec ?? null,
    audioCodec: audio?.codec ?? null,
    rotation: (matrix ? rotationFromMatrix(matrix) : null) ?? 0,
    width: video?.video?.width ?? null,
    height: video?.video?.height ?? null,
  };
};
