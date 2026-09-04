import type { MediaAsset, MediaKind } from "@movie-desk/core";
import { type Geocode, formatDayLabel } from "./organize";

// Library search over what the app already knows about each asset: name,
// capture day and place, codec, camera, kind and size class. The index is
// a pure function of the library, so the bin rebuilds it only when the
// library changes, and every filter is a small predicate that can be
// combined with free text.

export type DurationFilter = "any" | "short" | "medium" | "long";
export type ResolutionFilter = "any" | "sd" | "hd" | "fhd" | "uhd";
export type PeriodFilter = "any" | "today" | "week" | "month" | "year";
export type AudioFilter = "any" | "with" | "without";

export interface MediaFilters {
  readonly kind: MediaKind | "all";
  readonly duration: DurationFilter;
  readonly resolution: ResolutionFilter;
  readonly period: PeriodFilter;
  readonly place: string | null;
  readonly audio: AudioFilter;
}

export const DEFAULT_FILTERS: MediaFilters = {
  kind: "all",
  duration: "any",
  resolution: "any",
  period: "any",
  place: null,
  audio: "any",
};

export const hasActiveFilters = (filters: MediaFilters): boolean =>
  filters.kind !== "all" ||
  filters.duration !== "any" ||
  filters.resolution !== "any" ||
  filters.period !== "any" ||
  filters.place !== null ||
  filters.audio !== "any";

// Under 10 s is a moment, up to a minute a scene, longer a whole take.
export const durationClass = (asset: MediaAsset): Exclude<DurationFilter, "any"> | null => {
  if (asset.kind === "image" || !asset.durationMs) return null;
  if (asset.durationMs < 10_000) return "short";
  if (asset.durationMs < 60_000) return "medium";
  return "long";
};

// By the longer side, so portrait footage classifies like its landscape twin.
export const resolutionClass = (asset: MediaAsset): Exclude<ResolutionFilter, "any"> | null => {
  if (!asset.width || !asset.height) return null;
  const longSide = Math.max(asset.width, asset.height);
  if (longSide >= 3800) return "uhd";
  if (longSide >= 1900) return "fhd";
  if (longSide >= 1200) return "hd";
  return "sd";
};

export const RESOLUTION_LABEL: Record<Exclude<ResolutionFilter, "any">, string> = {
  sd: "SD",
  hd: "HD",
  fhd: "1080p",
  uhd: "4K",
};

const hasAudio = (asset: MediaAsset): boolean =>
  asset.kind === "audio" || (asset.kind === "video" && asset.waveformPeaks !== undefined);

export interface SearchEntry {
  readonly asset: MediaAsset;
  readonly place: string | null;
  readonly text: string; // lowercased haystack for free-text tokens
}

const placeOf = (asset: MediaAsset, geocode: Geocode): string | null =>
  asset.gpsLat !== undefined && asset.gpsLon !== undefined
    ? geocode(asset.gpsLat, asset.gpsLon)
    : null;

export const buildSearchIndex = (
  assets: readonly MediaAsset[],
  geocode: Geocode,
  locale: string,
  now = Date.now(),
): ReadonlyMap<string, SearchEntry> => {
  const index = new Map<string, SearchEntry>();
  for (const asset of assets) {
    const place = placeOf(asset, geocode);
    const resolution = resolutionClass(asset);
    const parts = [
      asset.name,
      asset.kind,
      place ?? "",
      asset.capturedAt !== undefined ? formatDayLabel(asset.capturedAt, locale, now) : "",
      asset.capturedAt !== undefined ? new Date(asset.capturedAt).toLocaleDateString(locale) : "",
      asset.videoCodec ?? "",
      asset.audioCodec ?? "",
      asset.mime,
      resolution ? RESOLUTION_LABEL[resolution] : "",
      asset.sourceImageMetadata?.cameraMake ?? "",
      asset.sourceImageMetadata?.cameraModel ?? "",
      asset.livePhoto ? "live" : "",
    ];
    index.set(asset.id, { asset, place, text: parts.join(" ").toLowerCase() });
  }
  return index;
};

// Every whitespace-separated token must appear somewhere in the haystack.
export const matchesQuery = (entry: SearchEntry, query: string): boolean => {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => entry.text.includes(token));
};

const periodStart = (period: Exclude<PeriodFilter, "any">, now: number): number => {
  const d = new Date(now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  switch (period) {
    case "today":
      return midnight;
    case "week":
      return midnight - 6 * 24 * 60 * 60 * 1000;
    case "month":
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    case "year":
      return new Date(d.getFullYear(), 0, 1).getTime();
  }
};

export const matchesFilters = (
  entry: SearchEntry,
  filters: MediaFilters,
  now = Date.now(),
): boolean => {
  const { asset } = entry;
  if (filters.kind !== "all" && asset.kind !== filters.kind) return false;
  if (filters.duration !== "any" && durationClass(asset) !== filters.duration) return false;
  if (filters.resolution !== "any" && resolutionClass(asset) !== filters.resolution) return false;
  if (filters.place !== null && entry.place !== filters.place) return false;
  if (filters.audio === "with" && !hasAudio(asset)) return false;
  if (filters.audio === "without" && hasAudio(asset)) return false;
  if (filters.period !== "any") {
    if (asset.capturedAt === undefined) return false;
    if (asset.capturedAt < periodStart(filters.period, now)) return false;
  }
  return true;
};

export const searchAssets = (
  index: ReadonlyMap<string, SearchEntry>,
  assets: readonly MediaAsset[],
  query: string,
  filters: MediaFilters,
  now = Date.now(),
): readonly MediaAsset[] =>
  assets.filter((asset) => {
    const entry = index.get(asset.id);
    if (!entry) return false;
    return matchesFilters(entry, filters, now) && matchesQuery(entry, query);
  });

// Distinct places in first-seen order, for the place filter.
export const collectPlaces = (index: ReadonlyMap<string, SearchEntry>): readonly string[] => {
  const places: string[] = [];
  for (const entry of index.values()) {
    if (entry.place && !places.includes(entry.place)) places.push(entry.place);
  }
  return places;
};
