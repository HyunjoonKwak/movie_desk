import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toByteSource } from "../mp4-decoder";
import { openMp4, videoDecoderConfig } from "../mp4-demux";

const fixture = (name: string): Blob =>
  new Blob([readFileSync(new URL(`../../media/__tests__/fixtures/${name}`, import.meta.url))]);

// Shared demux entry for the playhead decoder, the linear sampler and the
// audio remux: parse only the metadata window and expose what WebCodecs
// needs to configure a decoder.
describe("openMp4", () => {
  it("exposes the HEVC track of a QuickTime file with its hvcC description", async () => {
    const opened = await openMp4(toByteSource(fixture("hevc-plain.mov")));
    expect(opened).not.toBeNull();
    const track = opened?.videoTrack;
    expect(track?.codec).toMatch(/^hvc1\./);
    const config = opened ? videoDecoderConfig(opened) : null;
    expect(config?.codec).toBe(track?.codec);
    expect(config?.codedWidth).toBe(160);
    expect(config?.description).toBeInstanceOf(Uint8Array);
  });

  it("exposes the AVC track of an MP4 with its avcC description", async () => {
    const opened = await openMp4(toByteSource(fixture("aac-video.mp4")));
    const config = opened ? videoDecoderConfig(opened) : null;
    expect(config?.codec).toMatch(/^avc1\./);
    expect(config?.description).toBeInstanceOf(Uint8Array);
    expect(opened?.durationMs).toBeGreaterThan(900);
  });

  it("returns null for bytes that are not an MP4", async () => {
    expect(await openMp4(toByteSource(new Blob([new Uint8Array(64)])))).toBeNull();
  });
});
