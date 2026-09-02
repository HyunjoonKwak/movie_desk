import { describe, expect, it } from "vitest";
import type { ID, MediaAsset } from "@movie-desk/core";
import { guessTransport, haversineKm, isGoldenHour, sunTimes } from "../geo";
import { coordLabel, reverseGeocode } from "../geocode";
import { buildStory, chapterBreaks, goldenStats } from "../story";

const asset = (
  id: string,
  capturedAt: number,
  gps?: { lat: number; lon: number },
): MediaAsset =>
  ({
    id: id as ID,
    name: `${id}.mp4`,
    kind: "video",
    mime: "video/mp4",
    durationMs: 5000,
    opfsPath: `${id}__x`,
    importedAt: capturedAt,
    capturedAt,
    ...(gps ? { gpsLat: gps.lat, gpsLon: gps.lon } : {}),
  }) as MediaAsset;

describe("geo math", () => {
  it("haversine Seoul→Busan ≈ 325km", () => {
    const km = haversineKm(37.5665, 126.978, 35.1796, 129.0756);
    expect(km).toBeGreaterThan(300);
    expect(km).toBeLessThan(340);
  });

  it("sunTimes Seoul summer solstice: sunset ≈ 19:57 KST (±15min)", () => {
    const t = sunTimes(Date.UTC(2026, 5, 21, 3, 0, 0), 37.5665, 126.978)!;
    const sunsetKstMin =
      new Date(t.sunset).getUTCHours() * 60 + new Date(t.sunset).getUTCMinutes() + 9 * 60;
    expect(Math.abs(sunsetKstMin - (19 * 60 + 57) % 1440)).toBeLessThan(15);
  });

  it("golden hour is true near sunset, false at noon", () => {
    const t = sunTimes(Date.UTC(2026, 5, 21, 3, 0, 0), 37.5665, 126.978)!;
    expect(isGoldenHour(t.sunset - 10 * 60000, 37.5665, 126.978)).toBe(true);
    const noonKst = Date.UTC(2026, 5, 21, 3, 30, 0); // 12:30 KST
    expect(isGoldenHour(noonKst, 37.5665, 126.978)).toBe(false);
  });

  it("transport tiers", () => {
    expect(guessTransport(3, 1)).toBe("walk");
    expect(guessTransport(180, 2.5)).toBe("drive");
    expect(guessTransport(280, 1.2)).toBe("train");
    expect(guessTransport(900, 1.5)).toBe("flight");
  });
});

describe("reverse geocode", () => {
  it("resolves Gangneung and Paris; falls back to coordinates offshore", () => {
    expect(reverseGeocode(37.75, 128.88)).toBe("강릉");
    expect(reverseGeocode(48.86, 2.35)).toBe("Paris");
    expect(reverseGeocode(0, -140)).toBeNull();
    expect(coordLabel(37.45, 129.17)).toBe("37.45°N 129.17°E");
  });
});

describe("buildStory", () => {
  const D0 = Date.UTC(2026, 5, 27, 0, 0, 0);
  const seoul = { lat: 37.5665, lon: 126.978 };
  const gangneung = { lat: 37.7519, lon: 128.8761 };

  it("splits events on distance, labels days+places, detects the move", () => {
    const assets = [
      asset("a1", D0 + 1 * 3600_000, seoul),
      asset("a2", D0 + 1.2 * 3600_000, seoul),
      asset("b1", D0 + 4 * 3600_000, gangneung), // 165km east, 3h later
      asset("b2", D0 + 26 * 3600_000, gangneung), // next day, same place (gap split)
    ];
    const story = buildStory(assets);
    expect(story.events.length).toBe(3);
    expect(story.events[0]!.label).toBe("Day 1 — 서울");
    expect(story.events[1]!.label).toBe("Day 1 — 강릉");
    expect(story.events[2]!.label).toContain("Day 2 — 강릉");
    expect(story.days).toBe(2);
    expect(story.moves).toHaveLength(1);
    expect(story.moves[0]!.label).toContain("서울 → 강릉");
    expect(story.moves[0]!.km).toBeGreaterThan(120);
    expect(story.summary).toMatch(/2일 · \d+곳 · \d+km/);
    const breaks = chapterBreaks(story);
    expect(breaks[0]!.fromCapturedAt).toBe(D0 + 1 * 3600_000);
  });

  it("works without GPS: day-only chapters, no moves", () => {
    const assets = [asset("a", D0 + 3600_000), asset("b", D0 + 30 * 3600_000)];
    const story = buildStory(assets);
    expect(story.events.length).toBe(2);
    expect(story.events[0]!.label).toBe("Day 1");
    expect(story.events[1]!.label).toBe("Day 2");
    expect(story.moves).toHaveLength(0);
  });

  it("goldenStats counts sunset-window captures", () => {
    const t = sunTimes(Date.UTC(2026, 5, 27, 9, 0), 37.75, 128.88)!;
    const assets = [
      asset("g", t.sunset - 20 * 60000, gangneung),
      asset("n", Date.UTC(2026, 5, 27, 3, 0), gangneung),
    ];
    expect(goldenStats(assets).goldenRatio).toBeCloseTo(0.5);
  });
});
