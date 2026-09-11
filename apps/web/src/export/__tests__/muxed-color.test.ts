import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { muxedColorIsBt709 } from "../muxed-color";

const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../media/__tests__/fixtures/${name}`, import.meta.url))),
  );

describe("muxedColorIsBt709", () => {
  it("is false for a container without colour tags and for garbage", async () => {
    expect(await muxedColorIsBt709(fixture("aac-video.mp4"))).toBe(false);
    expect(await muxedColorIsBt709(new Uint8Array([1, 2, 3, 4]))).toBe(false);
    expect(await muxedColorIsBt709(new ArrayBuffer(0))).toBe(false);
  });
});
