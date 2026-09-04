import type { ID, MediaAsset, MediaKind, Rating } from "@movie-desk/core";
import { tagKey } from "./tags";
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
export type UsageFilter = "any" | "used" | "unused";
export type MinRating = 0 | Rating; // 0 = any

export interface MediaFilters {
  readonly kind: MediaKind | "all";
  readonly duration: DurationFilter;
  readonly resolution: ResolutionFilter;
  readonly period: PeriodFilter;
  readonly place: string | null;
  readonly audio: AudioFilter;
  readonly tags: readonly string[]; // every tag must be present (AND)
  readonly minRating: MinRating;
  readonly favorite: boolean; // true = favourites only
  readonly usage: UsageFilter; // needs SearchContext.used
  readonly collection: ID | null; // manual collection membership; needs SearchContext.collections
}

export const DEFAULT_FILTERS: MediaFilters = {
  kind: "all",
  duration: "any",
  resolution: "any",
  period: "any",
  place: null,
  audio: "any",
  tags: [],
  minRating: 0,
  favorite: false,
  usage: "any",
  collection: null,
};

export const hasActiveFilters = (filters: MediaFilters): boolean =>
  filters.kind !== "all" ||
  filters.duration !== "any" ||
  filters.resolution !== "any" ||
  filters.period !== "any" ||
  filters.place !== null ||
  filters.audio !== "any" ||
  filters.tags.length > 0 ||
  filters.minRating !== 0 ||
  filters.favorite ||
  filters.usage !== "any" ||
  filters.collection !== null;

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
  readonly tagKeys: readonly string[]; // case-folded tags for exact "#tag" tokens and the tag filter
}

// What the filters need beyond the asset itself: the clock for period
// filters, the timeline's asset usage, and manual collection membership.
export interface SearchContext {
  readonly now?: number;
  readonly used?: ReadonlySet<ID> | undefined;
  readonly collections?: ReadonlyMap<ID, ReadonlySet<ID>>;
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
    ...(asset.tags ?? []),
  ];
  return {
    asset,
    place,
    text: parts.join(" ").toLowerCase(),
    tagKeys: (asset.tags ?? []).map(tagKey),
  };
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

// A "#tag" token matches a tag by prefix ("#sea" finds "sea" and "sea trip",
// and narrows while typing); a lone "#" matches everything; anything else
// is a substring of the haystack.
const matchesToken = (entry: SearchEntry, token: string): boolean => {
  if (token === "#") return true;
  if (token.startsWith("#")) {
    const prefix = token.slice(1);
    return entry.tagKeys.some((key) => key.startsWith(prefix));
  }
  return entry.text.includes(token);
};

export const matchesQuery = (entry: SearchEntry, query: string): boolean =>
  tokensOf(query).every((token) => matchesToken(entry, token));

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
  context: SearchContext = {},
): boolean => {
  const { asset } = entry;
  const now = context.now ?? Date.now();
  if (filters.kind !== "all" && asset.kind !== filters.kind) return false;
  if (filters.favorite && !asset.favorite) return false;
  if (filters.minRating !== 0 && (asset.rating ?? 0) < filters.minRating) return false;
  if (filters.tags.length > 0 && !filters.tags.every((tag) => entry.tagKeys.includes(tagKey(tag))))
    return false;
  if (filters.usage !== "any") {
    // Without a timeline in the context nothing is known to be used.
    const used = context.used?.has(asset.id) ?? false;
    if (used !== (filters.usage === "used")) return false;
  }
  if (filters.collection !== null && !context.collections?.get(filters.collection)?.has(asset.id))
    return false;
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
  context: SearchContext = {},
): readonly MediaAsset[] => {
  const tokens = tokensOf(query);
  return assets.filter((asset) => {
    const entry = index.get(asset.id);
    if (!entry) return false;
    return (
      matchesFilters(entry, filters, context) && tokens.every((token) => matchesToken(entry, token))
    );
  });
};

export interface TagCount {
  readonly tag: string; // first spelling seen
  readonly count: number;
}

// Distinct tags with how many assets carry each, most used first, then by
// name in the UI locale's order.
export const collectTags = (
  index: ReadonlyMap<string, SearchEntry>,
  locale?: string,
): readonly TagCount[] => {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const entry of index.values()) {
    for (const tag of entry.asset.tags ?? []) {
      const key = tagKey(tag);
      const current = counts.get(key);
      if (current) counts.set(key, { tag: current.tag, count: current.count + 1 });
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, locale, { sensitivity: "base" }),
  );
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
