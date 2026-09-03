import type { ExportPreset } from "./types";

export const PRESETS: readonly ExportPreset[] = [
  {
    id: "family-720p",
    name: "Family message 720p",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrateKbps: 2500,
    audioBitrateKbps: 128,
  },
  {
    id: "youtube-1080p",
    name: "YouTube 1080p",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrateKbps: 8000,
    audioBitrateKbps: 192,
  },
  {
    id: "youtube-4k",
    name: "YouTube 4K",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 3840,
    height: 2160,
    fps: 30,
    videoBitrateKbps: 35_000,
    audioBitrateKbps: 192,
  },
  {
    id: "tv-tablet-4k",
    name: "TV / Tablet 4K",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 3840,
    height: 2160,
    fps: 30,
    videoBitrateKbps: 25_000,
    audioBitrateKbps: 192,
  },
  {
    id: "tiktok-9-16",
    name: "TikTok / Reels 9:16",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrateKbps: 8000,
    audioBitrateKbps: 192,
  },
  {
    // VP9 video is genuinely encoded, but the MP4 writer only takes MP4 containers and
    // only AAC audio is supported — so this is a VP9-in-MP4 file, not WebM.
    // Labeled and configured to match reality (and so audio isn't dropped).
    id: "web-vp9",
    name: "Web (VP9 · MP4)",
    container: "mp4",
    videoCodec: "vp9",
    audioCodec: "aac",
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrateKbps: 6000,
    audioBitrateKbps: 128,
  },
];

// A bitrate-based estimate cannot predict every encoder decision, but it is
// useful before a long render and especially for message-size planning.
// Reserve 2% for MP4 metadata and muxing overhead.
export const estimateExportSizeMb = (preset: ExportPreset, durationMs: number): number => {
  const payloadBits =
    (preset.videoBitrateKbps + preset.audioBitrateKbps) * 1000 * (Math.max(0, durationMs) / 1000);
  return (payloadBits / 8 / 1_000_000) * 1.02;
};
