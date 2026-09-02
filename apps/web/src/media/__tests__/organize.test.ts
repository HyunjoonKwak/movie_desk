import type { ID, MediaAsset } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { formatDayLabel, groupByDay, sortAssets } from "../organize";

// Local-time constructors keep the day boundaries stable in any timezone.
const at = (month: number, day: number, hour: number): number =>
  new Date(2026, month - 1, day, hour).getTime();

let seq = 0;
const asset = (
  name: string,
  patch: Partial<MediaAsset> & { kind?: MediaAsset["kind"] } = {},
): MediaAsset => ({
  id: `a${++seq}` as ID,
  name,
  kind: "video",
  mime: "video/mp4",
  durationMs: 1000,
  opfsPath: `opfs/${name}`,
  importedAt: 1_000 + seq,
  ...patch,
});

describe("sortAssets", () => {
  it("orders by capture time, undated last, import order untouched", () => {
    const late = asset("late", { capturedAt: at(8, 12, 15) });
    const early = asset("early", { capturedAt: at(8, 12, 9) });
    const undated = asset("undated");
    const list = [late, undated, early];

    expect(sortAssets(list, "captured").map((a) => a.name)).toEqual(["early", "late", "undated"]);
    expect(sortAssets(list, "imported").map((a) => a.name)).toEqual(["late", "undated", "early"]);
  });

  it("breaks capture-time ties by name so photo bursts stay deterministic", () => {
    const b = asset("IMG_002", { capturedAt: at(8, 12, 9) });
    const a = asset("IMG_001", { capturedAt: at(8, 12, 9) });
    expect(sortAssets([b, a], "captured").map((x) => x.name)).toEqual(["IMG_001", "IMG_002"]);
  });
});

describe("groupByDay", () => {
  const geocode = (lat: number, lon: number): string | null =>
    lat < 30 ? null : lon > 128 ? "강릉" : "서울";

  it("splits on local calendar day and keeps the incoming order inside a day", () => {
    const list = sortAssets(
      [
        asset("d2-a", { capturedAt: at(8, 13, 8) }),
        asset("d1-b", { capturedAt: at(8, 12, 23) }),
        asset("d1-a", { capturedAt: at(8, 12, 7) }),
      ],
      "captured",
    );
    const groups = groupByDay(list, geocode);
    expect(groups.map((g) => g.assets.map((a) => a.name))).toEqual([["d1-a", "d1-b"], ["d2-a"]]);
    expect(groups[0]!.dayStart).toBe(new Date(2026, 7, 12).getTime());
    expect(groups[0]!.key).toBe("2026-08-12");
  });

  it("names each day by the distinct places seen, in first-seen order", () => {
    const groups = groupByDay(
      [
        asset("seoul-1", { capturedAt: at(8, 12, 7), gpsLat: 37.57, gpsLon: 126.98 }),
        asset("gangneung", { capturedAt: at(8, 12, 12), gpsLat: 37.75, gpsLon: 128.9 }),
        asset("seoul-2", { capturedAt: at(8, 12, 20), gpsLat: 37.56, gpsLon: 126.97 }),
        asset("no-gps", { capturedAt: at(8, 12, 21) }),
        asset("unknown-place", { capturedAt: at(8, 12, 22), gpsLat: 10, gpsLon: 10 }),
      ],
      geocode,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.places).toEqual(["서울", "강릉"]);
  });

  it("parks undated footage and audio in trailing groups", () => {
    const groups = groupByDay(
      [
        asset("clip", { capturedAt: at(8, 12, 7) }),
        asset("undated"),
        asset("song", { kind: "audio", mime: "audio/mpeg", capturedAt: at(8, 12, 8) }),
      ],
      geocode,
    );
    expect(groups.map((g) => g.key)).toEqual(["2026-08-12", "undated", "audio"]);
    expect(groups[1]!.dayStart).toBeNull();
    expect(groups[2]!.assets[0]!.name).toBe("song");
  });

  it("returns no groups for an empty list", () => {
    expect(groupByDay([], geocode)).toEqual([]);
  });
});

describe("formatDayLabel", () => {
  const day = new Date(2026, 7, 12).getTime();

  it("shows month, day and weekday in the viewer's language", () => {
    expect(formatDayLabel(day, "ko", new Date(2026, 8, 1).getTime())).toBe("8월 12일 (수)");
    expect(formatDayLabel(day, "en", new Date(2026, 8, 1).getTime())).toBe("Wed, Aug 12");
  });

  it("adds the year only when it differs from the current one", () => {
    expect(formatDayLabel(day, "en", new Date(2027, 0, 1).getTime())).toBe("Wed, Aug 12, 2026");
    expect(formatDayLabel(day, "ko", new Date(2027, 0, 1).getTime())).toBe("2026년 8월 12일 (수)");
  });
});
