import type { ID, MediaAsset } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  buildSearchIndex,
  collectPlaces,
  durationClass,
  hasActiveFilters,
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

const index = buildSearchIndex(library, geocode, "ko", NOW);
const search = (query: string, filters = DEFAULT_FILTERS) =>
  searchAssets(index, library, query, filters, NOW).map((a) => a.id);

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

  it("reports whether anything is active and lists places once", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, place: "강릉" })).toBe(true);
    expect(collectPlaces(index)).toEqual(["강릉", "서울"]);
  });
});
