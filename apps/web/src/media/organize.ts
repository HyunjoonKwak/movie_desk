import type { MediaAsset } from "@cut/core";

// "Throw footage in and it comes back organized": ordering and day grouping
// for the media bin. Pure functions; the bin injects the geocoder so tests
// stay deterministic and the gazetteer stays out of this module.

export type MediaOrder = "captured" | "imported";
export type Geocode = (lat: number, lon: number) => string | null;

export const UNDATED_GROUP = "undated";
export const AUDIO_GROUP = "audio";

export interface MediaDayGroup {
  readonly key: string; // local "YYYY-MM-DD", UNDATED_GROUP, or AUDIO_GROUP
  readonly dayStart: number | null; // local midnight (epoch ms); null for the trailing groups
  readonly places: readonly string[]; // distinct geocoded places, first-seen order
  readonly assets: readonly MediaAsset[];
}

const pad = (n: number): string => String(n).padStart(2, "0");

const localDayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const localDayStart = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

// Capture order puts undated assets last and breaks exact ties by name so a
// photo burst with identical timestamps keeps its shot order.
export const sortAssets = (
  assets: readonly MediaAsset[],
  order: MediaOrder,
): readonly MediaAsset[] => {
  if (order === "imported") return assets;
  return [...assets].sort((x, y) => {
    if (x.capturedAt === undefined || y.capturedAt === undefined) {
      return Number(x.capturedAt === undefined) - Number(y.capturedAt === undefined);
    }
    return x.capturedAt - y.capturedAt || x.name.localeCompare(y.name);
  });
};

interface DayAccumulator {
  readonly dayStart: number;
  readonly places: string[];
  readonly assets: MediaAsset[];
}

// Groups follow the incoming order inside a day; days are sorted ascending.
// Audio never has a meaningful capture day, so it lands in its own group.
export const groupByDay = (
  assets: readonly MediaAsset[],
  geocode: Geocode,
): readonly MediaDayGroup[] => {
  const days = new Map<string, DayAccumulator>();
  const undated: MediaAsset[] = [];
  const audio: MediaAsset[] = [];

  for (const asset of assets) {
    if (asset.kind === "audio") {
      audio.push(asset);
      continue;
    }
    if (asset.capturedAt === undefined) {
      undated.push(asset);
      continue;
    }
    const key = localDayKey(asset.capturedAt);
    const day = days.get(key) ?? {
      dayStart: localDayStart(asset.capturedAt),
      places: [],
      assets: [],
    };
    day.assets.push(asset);
    if (asset.gpsLat !== undefined && asset.gpsLon !== undefined) {
      const place = geocode(asset.gpsLat, asset.gpsLon);
      if (place && !day.places.includes(place)) day.places.push(place);
    }
    days.set(key, day);
  }

  const dated: MediaDayGroup[] = [...days.entries()]
    .sort(([, a], [, b]) => a.dayStart - b.dayStart)
    .map(([key, day]) => ({ key, ...day }));
  const trailing: MediaDayGroup[] = [
    ...(undated.length > 0 ? [{ key: UNDATED_GROUP, dayStart: null, places: [], assets: undated }] : []),
    ...(audio.length > 0 ? [{ key: AUDIO_GROUP, dayStart: null, places: [], assets: audio }] : []),
  ];
  return [...dated, ...trailing];
};

// "8월 12일 (수)" / "Wed, Aug 12"; the year appears only when it is not the
// current one, so a fresh trip reads naturally and an old archive stays clear.
export const formatDayLabel = (dayStart: number, locale: string, now = Date.now()): string => {
  const sameYear = new Date(dayStart).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    weekday: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(dayStart);
};
