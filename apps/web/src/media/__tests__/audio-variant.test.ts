import { readFileSync } from "node:fs";
import { readMediaFile, writeMediaFile } from "@/persistence/opfs";
import type { ID } from "@movie-desk/core";
import { beforeEach, describe, expect, it } from "vitest";
import { audioBlobFor, audioVariantKey, ensureAudioVariant } from "../audio/audio-variant";

// In node the OPFS module keeps files in memory, so the whole cache round
// trip (build → store → hit) runs without a browser.
const bytes = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

const stored = async (name: string, key: string) => {
  const file = new File([bytes(name)], name, { type: "video/mp4" });
  await writeMediaFile(key, file);
  return {
    id: `asset-${key}` as ID,
    opfsPath: key,
    sizeBytes: file.size,
    mime: "video/mp4",
    kind: "video" as const,
  };
};

describe("audio variant", () => {
  let counter = 0;
  beforeEach(() => {
    counter += 1;
  });

  it("derives an OPFS-safe key from the cache key", () => {
    const key = audioVariantKey({ opfsPath: "abc__clip.mp4", sizeBytes: 10 });
    expect(key).not.toContain("/");
    expect(key).toContain("audio-track");
    expect(audioVariantKey({ opfsPath: "abc__clip.mp4", sizeBytes: 11 })).not.toBe(key);
  });

  it("builds the variant once and serves it from the cache afterwards", async () => {
    const asset = await stored("aac-video.mp4", `orig-${counter}.mp4`);
    let builds = 0;
    const deps = { onBuild: () => builds++ };
    const first = await ensureAudioVariant(asset, deps);
    expect(first?.type).toBe("audio/mp4");
    expect(first?.size).toBeLessThan(asset.sizeBytes);
    expect(await readMediaFile(audioVariantKey(asset))).not.toBeNull();
    const second = await ensureAudioVariant(asset, deps);
    expect(second?.size).toBe(first?.size);
    expect(builds).toBe(1);
  });

  it("falls back to the original when no audio track can be extracted", async () => {
    const asset = await stored("video-only.mp4", `orig-${counter}.mp4`);
    expect(await ensureAudioVariant(asset)).toBeNull();
    const blob = await audioBlobFor(asset);
    expect(blob?.size).toBe(asset.sizeBytes);
    expect(await readMediaFile(audioVariantKey(asset))).toBeNull();
  });

  it("prefers the variant for audio-bearing assets", async () => {
    const asset = await stored("aac-video.mp4", `orig-${counter}.mp4`);
    const blob = await audioBlobFor(asset);
    expect(blob?.type).toBe("audio/mp4");
    expect(blob?.size).toBeLessThan(asset.sizeBytes);
  });
});
