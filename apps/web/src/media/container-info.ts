import type { RandomAccessMediaSource } from "@/media/source/media-source";
import { toByteSource } from "@/renderer/mp4-decoder";
import { openMp4 } from "@/renderer/mp4-demux";
import type { SourceRotation } from "@movie-desk/core";

// What import learns from an ISO BMFF container (MP4, QuickTime .mov)
// before anything is decoded: codec strings, the display rotation, and
// whether an audio track exists. Reads only the metadata window.

export interface Mp4ContainerInfo {
  readonly container: "mp4" | "mov";
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly rotation: SourceRotation;
  readonly width: number | null;
  readonly height: number | null;
}

export const readMp4ContainerInfo = async (
  input: Blob | RandomAccessMediaSource,
): Promise<Mp4ContainerInfo | null> => {
  const source = toByteSource(input);
  if (source.size === 0) return null;
  const opened = await openMp4(source);
  if (!opened) return null;
  try {
    const video = opened.videoTrack;
    return {
      container: opened.container,
      // "" means the track exists but its codec has no WebCodecs string.
      videoCodec: video ? video.codec : null,
      audioCodec: opened.audioTrack ? opened.audioTrack.codec : null,
      rotation: video?.rotation ?? 0,
      width: video?.codedWidth ?? null,
      height: video?.codedHeight ?? null,
    };
  } finally {
    opened.dispose();
  }
};
