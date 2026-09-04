import type { ID, MediaAsset } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  audioPresence,
  buildSearchIndex,
  collectPlaces,
  collectTags,
  durationClass,
  hasActiveFilters,
  msUntilNextMidnight,
  resolutionClass,
  searchAssets,
} from "../search";

const asset = (id: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id: id as ID,
  name: `${id}.mp4`,
  kind: "video",
  mime: "video/mp4",
  durationMs: 5_000,
  opfsPath: `${id}__${id}.mp4`,
  importedAt: 0,
  ...patch,
});

// 2026-09-04 12:00 local
const NOW = new Date(2026, 8, 4, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const geocode = (lat: number, _lon: number) => (lat > 37.5 ? "강릉" : "서울");

const library = [
  asset("beach", {
    name: "IMG_0001.MOV",
    capturedAt: NOW - 2 * DAY,
    gpsLat: 37.8,
    gpsLon: 128.9,
    width: 3840,
    height: 2160,
    durationMs: 90_000,
    videoCodec: "hvc1.1.6.L153.B0",
    audioCodec: "mp4a.40.2",
    waveformPeaks: [0.1],
  }),
  asset("cafe", {
    name: "cafe.mp4",
    capturedAt: NOW - 40 * DAY,
    gpsLat: 37.4,
    gpsLon: 127.0,
    width: 1080,
    height: 1920,
    durationMs: 8_000,
    videoCodec: "avc1.640028",
  }),
  asset("still", {
    name: "portrait.heic",
    kind: "image",
    mime: "image/heic",
    durationMs: 0,
    width: 4032,
    height: 3024,
  }),
  asset("song", {
    name: "song.m4a",
    kind: "audio",
    mime: "audio/mp4",
    durationMs: 200_000,
    audioCodec: "mp4a.40.2",
  }),
];

const index = buildSearchIndex(library, geocode, "ko");
const search = (query: string, filters = DEFAULT_FILTERS) =>
  searchAssets(index, library, query, filters, { now: NOW }).map((a) => a.id);

describe("classes", () => {
  it("classifies duration and resolution", () => {
    expect(durationClass(library[0] as MediaAsset)).toBe("long");
    expect(durationClass(library[1] as MediaAsset)).toBe("short");
    expect(durationClass(library[2] as MediaAsset)).toBeNull();
    expect(resolutionClass(library[0] as MediaAsset)).toBe("uhd");
    expect(resolutionClass(library[1] as MediaAsset)).toBe("fhd"); // portrait 1080×1920
    expect(resolutionClass(library[3] as MediaAsset)).toBeNull();
  });
});

describe("free text", () => {
  it("matches name, place, codec, resolution label and kind, all tokens required", () => {
    expect(search("강릉")).toEqual(["beach"]);
    expect(search("hvc1")).toEqual(["beach"]);
    expect(search("4k")).toEqual(["beach", "still"]);
    expect(search("audio")).toEqual(["song"]);
    expect(search("오디오")).toEqual(["song"]);
    expect(search("사진")).toEqual(["still"]);
    expect(search("2026-09")).toEqual(["beach"]);
    expect(search("서울 avc1")).toEqual(["cafe"]);
    expect(search("서울 hvc1")).toEqual([]);
    expect(search("")).toHaveLength(4);
  });
});

describe("filters", () => {
  it("combines kind, duration, resolution, place, audio and period", () => {
    expect(search("", { ...DEFAULT_FILTERS, kind: "image" })).toEqual(["still"]);
    expect(search("", { ...DEFAULT_FILTERS, duration: "short" })).toEqual(["cafe"]);
    expect(search("", { ...DEFAULT_FILTERS, resolution: "uhd" })).toEqual(["beach", "still"]);
    expect(search("", { ...DEFAULT_FILTERS, place: "서울" })).toEqual(["cafe"]);
    expect(search("", { ...DEFAULT_FILTERS, audio: "with" })).toEqual(["beach", "song"]);
    expect(search("", { ...DEFAULT_FILTERS, audio: "without" })).toEqual(["cafe", "still"]);
    expect(search("", { ...DEFAULT_FILTERS, period: "week" })).toEqual(["beach"]);
    expect(search("", { ...DEFAULT_FILTERS, period: "year" })).toEqual(["beach", "cafe"]);
    expect(search("mov", { ...DEFAULT_FILTERS, period: "week", place: "강릉" })).toEqual(["beach"]);
  });

  it("treats a video with no codec and no waveform as unknown, not silent", () => {
    const unknown = asset("old", { name: "old.mp4" });
    expect(audioPresence(unknown)).toBeNull();
    // Container read, no audio track reported.
    expect(audioPresence(asset("mute", { videoCodec: "avc1.640028" }))).toBe(false);
    expect(audioPresence(asset("peaks", { waveformPeaks: [0.2] }))).toBe(true);
    const all = [...library, unknown];
    const idx = buildSearchIndex(all, geocode, "ko");
    const ids = (audio: "with" | "without") =>
      searchAssets(idx, all, "", { ...DEFAULT_FILTERS, audio }, { now: NOW }).map((a) => a.id);
    expect(ids("with")).not.toContain("old");
    expect(ids("without")).not.toContain("old");
  });

  it("uses calendar boundaries for periods", () => {
    const midnight = new Date(2026, 8, 4, 0, 0, 0).getTime();
    const edge = asset("edge", { capturedAt: midnight });
    const before = asset("before", { capturedAt: midnight - 1 });
    const early = asset("early", { capturedAt: new Date(2026, 8, 1).getTime() });
    const lastMonth = asset("lastMonth", { capturedAt: new Date(2026, 7, 20).getTime() });
    const all = [edge, before, early, lastMonth];
    const idx = buildSearchIndex(all, geocode, "ko");
    const ids = (period: "today" | "week" | "month" | "year") =>
      searchAssets(idx, all, "", { ...DEFAULT_FILTERS, period }, { now: NOW }).map((a) => a.id);
    expect(ids("today")).toEqual(["edge"]);
    expect(ids("week")).toEqual(["edge", "before", "early"]);
    expect(ids("month")).toEqual(["edge", "before", "early"]);
    expect(ids("year")).toEqual(["edge", "before", "early", "lastMonth"]);
    expect(msUntilNextMidnight(NOW)).toBe(12 * 60 * 60 * 1000);
  });

  it("reuses an entry for an unchanged record and rebuilds it for a new one", () => {
    const a = asset("a");
    const first = buildSearchIndex([a], geocode, "ko").get("a");
    const second = buildSearchIndex([a], geocode, "ko").get("a");
    expect(second).toBe(first);
    const edited = { ...a, name: "renamed.mp4" };
    const third = buildSearchIndex([edited], geocode, "ko").get("a");
    expect(third).not.toBe(first);
    expect(third?.text).toContain("renamed");
  });

  it("reports whether anything is active and lists places once", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, place: "강릉" })).toBe(true);
    expect(collectPlaces(index)).toEqual(["강릉", "서울"]);
  });
});

describe("marks", () => {
  const sea = asset("sea", { tags: ["Sea", "Trip"], rating: 4, favorite: true });
  const hill = asset("hill", { tags: ["trip"], rating: 2 });
  const plain = asset("plain");
  const all = [sea, hill, plain];
  const idx = buildSearchIndex(all, geocode, "ko");
  const run = (query: string, patch: Partial<typeof DEFAULT_FILTERS>, context = {}) =>
    searchAssets(idx, all, query, { ...DEFAULT_FILTERS, ...patch }, { now: NOW, ...context }).map(
      (a) => a.id,
    );

  it("finds tags as free text and by prefix with a #token", () => {
    expect(run("sea", {})).toEqual(["sea"]);
    expect(run("#trip", {})).toEqual(["sea", "hill"]);
    expect(run("#tri", {})).toEqual(["sea", "hill"]);
    expect(run("#rip", {})).toEqual([]);
    expect(run("#", {})).toEqual(["sea", "hill", "plain"]);
  });

  it("filters by every tag, minimum rating and favourite, case-insensitively", () => {
    expect(run("", { tags: ["TRIP"] })).toEqual(["sea", "hill"]);
    expect(run("", { tags: ["trip", "sea"] })).toEqual(["sea"]);
    expect(run("", { minRating: 3 })).toEqual(["sea"]);
    expect(run("", { minRating: 1 })).toEqual(["sea", "hill"]);
    expect(run("", { favorite: true })).toEqual(["sea"]);
  });

  it("filters by timeline usage and manual collection through the context", () => {
    const used = new Set<ID>(["hill" as ID]);
    expect(run("", { usage: "used" }, { used })).toEqual(["hill"]);
    expect(run("", { usage: "unused" }, { used })).toEqual(["sea", "plain"]);
    // No timeline in the context: nothing is known to be used.
    expect(run("", { usage: "used" })).toEqual([]);
    const collections = new Map<ID, ReadonlySet<ID>>([
      ["c1" as ID, new Set<ID>(["plain" as ID, "ghost" as ID])],
    ]);
    expect(run("", { collection: "c1" as ID }, { collections })).toEqual(["plain"]);
    expect(run("", { collection: "missing" as ID }, { collections })).toEqual([]);
  });

  it("counts tags across the index, most used first, one spelling per tag", () => {
    expect(collectTags(idx)).toEqual([
      { tag: "Trip", count: 2 },
      { tag: "Sea", count: 1 },
    ]);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, tags: ["x"] })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, usage: "used" })).toBe(true);
  });
});
