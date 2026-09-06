import { describe, expect, it } from "vitest";
import type { ID, MediaClip } from "@movie-desk/core";
import { PitchCache, pitchCacheKey } from "../pitch-renderer";
const clip: MediaClip = {
  id: "c" as ID,
  assetId: "a" as ID,
  kind: "media",
  speed: 2,
  start: 0,
  duration: 1000,
  trimIn: 0,
  trimOut: 2000,
  keyframes: [],
  effects: [],
  preservePitch: true,
};
describe("preview pitch cache", () => {
  it("keys source revision, rate, trims, duration, toggle and speed curve but not timeline position", () => {
    const key = pitchCacheKey(clip, 48000);
    for (const change of [
      { speed: 1 },
      { trimIn: 20 },
      { trimOut: 1800 },
      { duration: 500 },
      { preservePitch: false },
      {
        keyframes: [
          { target: "speed", keyframes: [{ at: 0, value: 1, easing: "linear" as const }] },
        ],
      },
    ]) {
      expect(pitchCacheKey({ ...clip, ...change }, 48000)).not.toBe(key);
    }
    expect(pitchCacheKey(clip, 44100)).not.toBe(key);
    expect(pitchCacheKey(clip, 48000, 1)).not.toBe(key);
    expect(pitchCacheKey({ ...clip, start: 2000 }, 48000)).toBe(key);
  });
  it("evicts by bytes in LRU order and invalidates every variant of an asset", () => {
    const cache = new PitchCache<number>(10);
    cache.set("a1", 1, 4, "a");
    cache.set("b", 2, 4, "b");
    expect(cache.get("a1")).toBe(1);
    cache.set("a2", 3, 4, "a");
    expect(cache.get("b")).toBeUndefined();
    cache.forget("a");
    expect(cache.bytes).toBe(0);
    cache.set("large", 9, 11, "a");
    expect(cache.bytes).toBe(0);
  });
});

it("changes playback identity for speed/toggle/trim but keeps visual edits out", async () => {
  const { createEmptyProject } = await import("@movie-desk/core");
  const { pitchPlaybackKey } = await import("../pitch-renderer");
  const base = createEmptyProject().timeline.tracks;
  const tracks = base.map((track, i) => (i === 0 ? { ...track, clips: [clip] } : track));
  const key = pitchPlaybackKey(tracks);
  for (const change of [{ speed: 0.5 }, { trimIn: 50 }, { preservePitch: false }]) {
    expect(
      pitchPlaybackKey(
        tracks.map((t, i) => (i === 0 ? { ...t, clips: [{ ...clip, ...change }] } : t)),
      ),
    ).not.toBe(key);
  }
  expect(pitchPlaybackKey(tracks.map((t) => ({ ...t, height: 120 })))).toBe(key);
});
