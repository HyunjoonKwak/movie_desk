import { readFileSync } from "node:fs";
import { toByteSource } from "@/renderer/mp4-decoder";
import { describe, expect, it } from "vitest";
import { remuxAudioTrack } from "../audio/audio-track-remux";

// The audio cache variant is the source's AAC track re-muxed on its own: no
// re-encode, no video bytes. Fixtures: a 1 s 160×90 H.264 + AAC mono clip and
// the same picture without audio.
const fixture = (name: string): Blob =>
  new Blob([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], { type: "video/mp4" });

const inspect = async (blob: Blob) => {
  const MP4Box = await import("mp4box");
  const file = MP4Box.createFile();
  const info = await new Promise<{
    audioTracks: { codec: string; nb_samples: number }[];
    videoTracks: unknown[];
  }>((resolve, reject) => {
    file.onError = reject;
    file.onReady = resolve;
    blob.arrayBuffer().then((buffer) => {
      const chunk = buffer as ArrayBuffer & { fileStart: number };
      chunk.fileStart = 0;
      file.appendBuffer(chunk);
      file.flush();
    });
  });
  return info;
};

describe("remuxAudioTrack", () => {
  it("keeps the AAC samples and drops the video track", async () => {
    const input = fixture("aac-video.mp4");
    const result = await remuxAudioTrack(toByteSource(input));
    expect(result).not.toBeNull();
    expect(result?.codec).toBe("mp4a.40.2");
    expect(result?.sampleRate).toBe(22050);
    expect(result?.channelCount).toBe(1);
    expect(result?.durationMs).toBeGreaterThan(900);
    expect(result?.blob.size).toBeLessThan(input.size);
    const info = await inspect(result?.blob as Blob);
    expect(info.videoTracks).toHaveLength(0);
    expect(info.audioTracks).toHaveLength(1);
    expect(info.audioTracks[0]?.codec).toBe("mp4a.40.2");
    expect(info.audioTracks[0]?.nb_samples).toBe(result?.sampleCount);
  });

  it("returns null for a file without an audio track", async () => {
    expect(await remuxAudioTrack(toByteSource(fixture("video-only.mp4")))).toBeNull();
  });

  it("returns null for bytes that are not an MP4", async () => {
    const webmish = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 1, 2, 3, 4])]);
    expect(await remuxAudioTrack(toByteSource(webmish))).toBeNull();
  });
});
