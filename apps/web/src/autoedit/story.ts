import type { MediaAsset } from "@movie-desk/core";
import { haversineKm, isGoldenHour, guessTransport, TRANSPORT_LABEL, type Transport } from "./geo";
import { coordLabel, reverseGeocode } from "./geocode";
import type { ChapterBreak } from "./assembler";

// Place-event clustering — 설계: 시간 간격 > 90분 또는 이동 거리 > 1km에서 분할.

export interface PlaceEvent {
  readonly label: string; // "강릉" | "Day 2" | coord fallback
  readonly dayIndex: number; // 0-based trip day
  readonly startAt: number; // epoch ms
  readonly endAt: number;
  readonly lat?: number;
  readonly lon?: number;
  readonly assetIds: readonly string[];
}

export interface TravelMove {
  readonly from: PlaceEvent;
  readonly to: PlaceEvent;
  readonly km: number;
  readonly transport: Transport;
  readonly label: string; // "서울 → 강릉 · 180km · 차량"
}

export interface StoryArc {
  readonly events: readonly PlaceEvent[];
  readonly moves: readonly TravelMove[]; // moves ≥ minMoveKm between events
  readonly days: number;
  readonly totalKm: number;
  readonly summary: string; // 여행 요약 카드 텍스트
}

const GAP_MS = 90 * 60 * 1000;
const SPLIT_KM = 1;
const MOVE_KM = 10;

const dayKey = (epochMs: number): number => Math.floor(epochMs / 86_400_000);

export const buildStory = (assets: readonly MediaAsset[]): StoryArc => {
  const timed = assets
    .filter((a) => a.kind !== "audio")
    .map((a) => ({ a, at: a.capturedAt ?? a.importedAt }))
    .sort((x, y) => x.at - y.at);

  const events: PlaceEvent[] = [];
  type Cluster = { start: number; end: number; lats: number[]; lons: number[]; ids: string[] };
  let cur: Cluster | null = null;

  const flush = (c: Cluster | null) => {
    if (!c || c.ids.length === 0) return;
    const lat = c.lats.length > 0 ? c.lats.reduce((s, v) => s + v, 0) / c.lats.length : undefined;
    const lon = c.lons.length > 0 ? c.lons.reduce((s, v) => s + v, 0) / c.lons.length : undefined;
    events.push({
      label: "", // named later (needs day indices)
      dayIndex: 0,
      startAt: c.start,
      endAt: c.end,
      ...(lat !== undefined && lon !== undefined ? { lat, lon } : {}),
      assetIds: c.ids,
    });
  };

  for (const { a, at } of timed) {
    const lat = a.gpsLat;
    const lon = a.gpsLon;
    const moved =
      cur &&
      lat !== undefined &&
      lon !== undefined &&
      cur.lats.length > 0 &&
      haversineKm(
        cur.lats.reduce((s, v) => s + v, 0) / cur.lats.length,
        cur.lons.reduce((s, v) => s + v, 0) / cur.lons.length,
        lat,
        lon,
      ) > SPLIT_KM;
    if (!cur || at - cur.end > GAP_MS || moved) {
      flush(cur);
      cur = { start: at, end: at, lats: [], lons: [], ids: [] };
    }
    cur.end = Math.max(cur.end, at);
    cur.ids.push(a.id);
    if (lat !== undefined && lon !== undefined) {
      cur.lats.push(lat);
      cur.lons.push(lon);
    }
  }
  flush(cur);

  // Day indices + labels.
  const day0 = events.length > 0 ? dayKey(events[0]!.startAt) : 0;
  const seenNames = new Map<string, number>();
  const named = events.map((e) => {
    const dayIndex = dayKey(e.startAt) - day0;
    let name: string | null = null;
    if (e.lat !== undefined && e.lon !== undefined) {
      name = reverseGeocode(e.lat, e.lon) ?? coordLabel(e.lat, e.lon);
    }
    const label = name ? `Day ${dayIndex + 1} — ${name}` : `Day ${dayIndex + 1}`;
    // Repeat visits to the same label get numbered ("… (2)")
    const n = (seenNames.get(label) ?? 0) + 1;
    seenNames.set(label, n);
    return { ...e, dayIndex, label: n > 1 ? `${label} (${n})` : label };
  });

  // Moves between consecutive located events.
  const moves: TravelMove[] = [];
  let totalKm = 0;
  for (let i = 1; i < named.length; i++) {
    const a = named[i - 1]!;
    const b = named[i]!;
    if (a.lat === undefined || a.lon === undefined || b.lat === undefined || b.lon === undefined)
      continue;
    const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
    totalKm += km;
    if (km < MOVE_KM) continue;
    const hours = Math.max(0.05, (b.startAt - a.endAt) / 3_600_000);
    const transport = guessTransport(km, hours);
    const fromName = a.label.split("— ")[1] ?? a.label;
    const toName = b.label.split("— ")[1] ?? b.label;
    moves.push({
      from: a,
      to: b,
      km,
      transport,
      label: `${fromName} → ${toName} · ${Math.round(km)}km · ${TRANSPORT_LABEL[transport]}`,
    });
  }

  const days = named.length > 0 ? named[named.length - 1]!.dayIndex + 1 : 0;
  const places = new Set(named.map((e) => e.label.split("— ")[1] ?? "").filter(Boolean)).size;
  const summary =
    days > 0
      ? `${days}일 · ${Math.max(places, named.length)}곳 · ${Math.round(totalKm)}km`
      : "";

  return { events: named, moves, days, totalKm, summary };
};

// Assembler chapter breaks from the story (record/growth modes).
export const chapterBreaks = (story: StoryArc): readonly ChapterBreak[] =>
  story.events.map((e) => ({ label: e.label, fromCapturedAt: e.startAt }));

// 골든아워 통계 — ② 분석 리포트와 추천 모드에 쓰인다.
export const goldenStats = (assets: readonly MediaAsset[]): { goldenRatio: number } => {
  const located = assets.filter(
    (a) => a.kind !== "audio" && a.gpsLat !== undefined && a.gpsLon !== undefined && a.capturedAt,
  );
  if (located.length === 0) return { goldenRatio: 0 };
  const golden = located.filter((a) => isGoldenHour(a.capturedAt!, a.gpsLat!, a.gpsLon!)).length;
  return { goldenRatio: golden / located.length };
};

// 골든아워 자산 우선 배치를 위한 점수 부스트 대상 집합.
export const goldenAssetIds = (assets: readonly MediaAsset[]): ReadonlySet<string> =>
  new Set(
    assets
      .filter(
        (a) =>
          a.kind !== "audio" &&
          a.gpsLat !== undefined &&
          a.gpsLon !== undefined &&
          a.capturedAt !== undefined &&
          isGoldenHour(a.capturedAt, a.gpsLat, a.gpsLon),
      )
      .map((a) => a.id),
  );
