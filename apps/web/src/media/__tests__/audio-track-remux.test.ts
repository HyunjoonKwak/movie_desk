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
  const { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } = await import("mediabunny");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const videoTracks = await input.getVideoTracks();
    const audioTracks = await input.getAudioTracks();
    const audio = audioTracks[0] ?? null;
    let packets = 0;
    if (audio) for await (const _ of new EncodedPacketSink(audio).packets()) packets += 1;
    return {
      videoTracks: videoTracks.length,
      audioTracks: audioTracks.length,
      codec: audio ? await audio.getCodecParameterString() : null,
      packets,
    };
  } finally {
    input.dispose();
  }
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
    expect(info.videoTracks).toBe(0);
    expect(info.audioTracks).toBe(1);
    expect(info.codec).toBe("mp4a.40.2");
    expect(info.packets).toBe(result?.sampleCount);
  });

  it("returns null for a file without an audio track", async () => {
    expect(await remuxAudioTrack(toByteSource(fixture("video-only.mp4")))).toBeNull();
  });

  it("returns null for bytes that are not an MP4", async () => {
    const webmish = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 1, 2, 3, 4])]);
    expect(await remuxAudioTrack(toByteSource(webmish))).toBeNull();
  });
});
