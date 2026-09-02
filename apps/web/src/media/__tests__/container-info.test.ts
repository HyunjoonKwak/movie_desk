import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMp4ContainerInfo } from "../container-info";

const fixture = (name: string, type = "video/mp4"): Blob =>
  new Blob([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], { type });

// What import needs from the container before any decoding: codec strings
// (to decide WebCodecs vs the media element), the display rotation, and
// whether there is an audio track for the audio variant.
describe("readMp4ContainerInfo", () => {
  it("reads a QuickTime HEVC file with a 90° display matrix", async () => {
    const info = await readMp4ContainerInfo(fixture("hevc-rotated90.mov", "video/quicktime"));
    expect(info?.brands[0]).toBe("qt  ");
    expect(info?.videoCodec).toMatch(/^hvc1\./);
    expect(info?.rotation).toBe(270); // ffmpeg's +90 is counter-clockwise
    expect(info?.audioCodec).toBeNull();
  });

  it("reads the opposite rotation and an unrotated file", async () => {
    expect(
      (await readMp4ContainerInfo(fixture("hevc-rotated270.mov", "video/quicktime")))?.rotation,
    ).toBe(90);
    const plain = await readMp4ContainerInfo(fixture("aac-video.mp4"));
    expect(plain?.rotation).toBe(0);
    expect(plain?.videoCodec).toMatch(/^avc1\./);
    expect(plain?.audioCodec).toBe("mp4a.40.2");
  });

  it("returns null for bytes that are not an ISO BMFF file", async () => {
    const webmish = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 1, 2, 3, 4])]);
    expect(await readMp4ContainerInfo(webmish)).toBeNull();
  });
});
