import type { MediaAsset, MediaKind } from "@movie-desk/core";
import type { Geocode } from "./organize";

// Library search over what the app already knows about each asset: name,
// capture date and place, codec, camera, kind and size class. Entries are
// cached per asset record (records are immutable), so editing one asset
// recomputes one entry, and every filter is a small predicate that can be
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

// Whether the asset carries audio: true, false, or null when nothing on the
// record says either way (a video imported before codecs were recorded and
// whose waveform could not be extracted). Unknown matches neither "with"
// nor "without": absence of evidence is not silence.
export const audioPresence = (asset: MediaAsset): boolean | null => {
  if (asset.kind === "audio") return true;
  if (asset.kind === "image") return false;
  if (asset.audioCodec) return true;
  if ((asset.waveformPeaks?.length ?? 0) > 0) return true;
  // The container was read (video codec known) and reported no audio track.
  if (asset.videoCodec) return false;
  return null;
};

// Korean-first product: a Korean user searching for 영상 or 사진 should find
// what "video" and "image" find.
const KIND_WORDS: Record<MediaKind, readonly string[]> = {
  video: ["video", "영상", "동영상", "비디오"],
  audio: ["audio", "오디오", "음악", "소리"],
  image: ["image", "photo", "사진", "이미지"],
};
const LIVE_WORDS = ["live", "라이브"];

export interface SearchEntry {
  readonly asset: MediaAsset;
  readonly place: string | null;
  readonly text: string; // lowercased haystack for free-text tokens
}

const pad = (n: number): string => String(n).padStart(2, "0");

// Absolute dates only ("2026-09-04", "2026-09", the locale's own format);
// relative words like "today" depend on the clock and would go stale.
const dateWords = (capturedAt: number, formatter: Intl.DateTimeFormat): string => {
  const d = new Date(capturedAt);
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${ymd} ${ymd.slice(0, 7)} ${formatter.format(d)}`;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const dateFormatter = (locale: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" });
    formatters.set(locale, formatter);
  }
  return formatter;
};

const buildEntry = (asset: MediaAsset, geocode: Geocode, locale: string): SearchEntry => {
  const place =
    asset.gpsLat !== undefined && asset.gpsLon !== undefined
      ? geocode(asset.gpsLat, asset.gpsLon)
      : null;
  const resolution = resolutionClass(asset);
  const parts = [
    asset.name,
    ...KIND_WORDS[asset.kind],
    place ?? "",
    asset.capturedAt !== undefined ? dateWords(asset.capturedAt, dateFormatter(locale)) : "",
    asset.videoCodec ?? "",
    asset.audioCodec ?? "",
    asset.mime,
    resolution ? RESOLUTION_LABEL[resolution] : "",
    asset.sourceImageMetadata?.cameraMake ?? "",
    asset.sourceImageMetadata?.cameraModel ?? "",
    ...(asset.livePhoto ? LIVE_WORDS : []),
  ];
  return { asset, place, text: parts.join(" ").toLowerCase() };
};

// Entries live as long as their asset record; a new record (any edit) gets a
// fresh entry, the rest are reused. Keyed per locale and geocoder.
const entryCache = new WeakMap<
  MediaAsset,
  { locale: string; geocode: Geocode; entry: SearchEntry }
>();

export const buildSearchIndex = (
  assets: readonly MediaAsset[],
  geocode: Geocode,
  locale: string,
): ReadonlyMap<string, SearchEntry> => {
  const index = new Map<string, SearchEntry>();
  for (const asset of assets) {
    const cached = entryCache.get(asset);
    const entry =
      cached && cached.locale === locale && cached.geocode === geocode
        ? cached.entry
        : buildEntry(asset, geocode, locale);
    if (entry !== cached?.entry) entryCache.set(asset, { locale, geocode, entry });
    index.set(asset.id, entry);
  }
  return index;
};

const tokensOf = (query: string): readonly string[] =>
  query.toLowerCase().split(/\s+/).filter(Boolean);

// Every whitespace-separated token must appear somewhere in the haystack.
export const matchesQuery = (entry: SearchEntry, query: string): boolean =>
  tokensOf(query).every((token) => entry.text.includes(token));

// Calendar arithmetic, so a DST change does not shift the window by an hour.
const periodStart = (period: Exclude<PeriodFilter, "any">, now: number): number => {
  const d = new Date(now);
  switch (period) {
    case "today":
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    case "week":
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime();
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
  if (filters.audio !== "any" && audioPresence(asset) !== (filters.audio === "with")) return false;
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
): readonly MediaAsset[] => {
  const tokens = tokensOf(query);
  return assets.filter((asset) => {
    const entry = index.get(asset.id);
    if (!entry) return false;
    return (
      matchesFilters(entry, filters, now) && tokens.every((token) => entry.text.includes(token))
    );
  });
};

// Distinct places in first-seen order, for the place filter.
export const collectPlaces = (index: ReadonlyMap<string, SearchEntry>): readonly string[] => {
  const places = new Set<string>();
  for (const entry of index.values()) if (entry.place) places.add(entry.place);
  return [...places];
};

// The next local midnight after `now`, for a clock that re-evaluates
// period filters and nothing else.
export const msUntilNextMidnight = (now = Date.now()): number => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - now;
};
