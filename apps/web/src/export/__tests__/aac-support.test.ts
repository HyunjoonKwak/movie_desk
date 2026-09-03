import { afterEach, describe, expect, it, vi } from "vitest";
import { aacEncoderSupported } from "../exporter";

const globalWithEncoder = globalThis as { AudioEncoder?: unknown };

describe("aacEncoderSupported", () => {
  afterEach(() => {
    globalWithEncoder.AudioEncoder = undefined;
  });

  it("is false without an AudioEncoder at all", async () => {
    expect(await aacEncoderSupported(128)).toBe(false);
  });

  it("asks the encoder about mp4a.40.2 at the preset bitrate", async () => {
    const isConfigSupported = vi.fn(async () => ({ supported: true }));
    globalWithEncoder.AudioEncoder = { isConfigSupported };
    expect(await aacEncoderSupported(192)).toBe(true);
    expect(isConfigSupported).toHaveBeenCalledWith(
      expect.objectContaining({ codec: "mp4a.40.2", bitrate: 192_000, numberOfChannels: 2 }),
    );
  });

  it("treats a rejected or unsupported answer as no AAC", async () => {
    globalWithEncoder.AudioEncoder = { isConfigSupported: async () => ({ supported: false }) };
    expect(await aacEncoderSupported(128)).toBe(false);
    globalWithEncoder.AudioEncoder = {
      isConfigSupported: async () => {
        throw new TypeError("bad config");
      },
    };
    expect(await aacEncoderSupported(128)).toBe(false);
  });
});
