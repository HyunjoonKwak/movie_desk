import { describe, expect, it } from "vitest";
import type { ID } from "@movie-desk/core";
import type { MusicRef } from "../types";
import { collectAllTags, collectTags, recommendMusic } from "../recommend";

const asId = (s: string): ID => s as ID;

let seq = 0;
const makeRef = (over: Partial<MusicRef>): MusicRef => ({
  id: asId(`ref-${seq++}`),
  title: "Track",
  license: "unknown",
  moods: [],
  scenes: [],
  addedAt: seq,
  ...over,
});

describe("recommendMusic", () => {
  it("ranks by mood/scene tag overlap and reports the matches", () => {
    const calm = makeRef({ title: "Calm", moods: ["잔잔한"], scenes: ["오프닝"] });
    const hype = makeRef({ title: "Hype", moods: ["신나는"], scenes: ["하이라이트"] });

    const out = recommendMusic([calm, hype], { moods: ["잔잔한"], scenes: ["오프닝"] });

    expect(out[0]!.ref.title).toBe("Calm");
    expect(out[0]!.matchedMoods).toEqual(["잔잔한"]);
    expect(out[0]!.matchedScenes).toEqual(["오프닝"]);
    // zero-overlap refs are filtered out when tags were requested
    expect(out).toHaveLength(1);
  });

  it("matches tags case- and whitespace-insensitively", () => {
    const r = makeRef({ moods: ["Lo-Fi "] });

    const out = recommendMusic([r], { moods: ["lo-fi"], scenes: [] });

    expect(out).toHaveLength(1);
    expect(out[0]!.matchedMoods).toEqual(["Lo-Fi "]);
  });

  it("returns everything ranked by readiness when no tags are requested", () => {
    const paidRef = makeRef({ title: "Paid" });
    const readyRef = makeRef({ title: "Ready", assetId: asId("asset-1") });

    const out = recommendMusic(
      [paidRef, readyRef],
      { moods: [], scenes: [] },
      new Map([[asId("asset-1"), { durationMs: 60_000 }]]),
    );

    expect(out).toHaveLength(2);
    expect(out[0]!.ref.title).toBe("Ready");
    expect(out[0]!.ready).toBe(true);
    expect(out[1]!.ready).toBe(false);
  });

  it("scores duration fit against the target length", () => {
    const long = makeRef({ title: "Long", moods: ["잔잔한"], assetId: asId("a-long") });
    const short = makeRef({ title: "Short", moods: ["잔잔한"], assetId: asId("a-short") });
    const assets = new Map([
      [asId("a-long"), { durationMs: 90_000 }],
      [asId("a-short"), { durationMs: 30_000 }],
    ]);

    const out = recommendMusic(
      [short, long],
      { moods: ["잔잔한"], scenes: [], targetMs: 60_000 },
      assets,
    );

    expect(out[0]!.ref.title).toBe("Long");
    expect(out[0]!.durationFit).toBe(1);
    expect(out[1]!.durationFit).toBe(0.5);
  });
});

describe("recommendMusic scoring edge cases", () => {
  it("tempo fit breaks ties between otherwise equal tracks", () => {
    const onBeat = makeRef({ title: "OnBeat", moods: ["신나는"], bpm: 120 });
    const offBeat = makeRef({ title: "OffBeat", moods: ["신나는"], bpm: 150 });

    const out = recommendMusic([offBeat, onBeat], {
      moods: ["신나는"],
      scenes: [],
      targetBpm: 120,
    });

    expect(out[0]!.ref.title).toBe("OnBeat");
    expect(out[0]!.tempoFit).toBe(1);
    expect(out[1]!.tempoFit).toBe(0);
  });

  it("leaves tempoFit null when either side lacks a BPM", () => {
    const noBpm = makeRef({ moods: ["신나는"] });

    const withTarget = recommendMusic([noBpm], { moods: ["신나는"], scenes: [], targetBpm: 120 });
    expect(withTarget[0]!.tempoFit).toBeNull();

    const noTarget = recommendMusic([makeRef({ moods: ["신나는"], bpm: 120 })], {
      moods: ["신나는"],
      scenes: [],
    });
    expect(noTarget[0]!.tempoFit).toBeNull();
  });

  it("counts a tag once when it is both a mood and a scene on one ref", () => {
    const dual = makeRef({ title: "Dual", moods: ["여행"], scenes: ["여행"] });
    const single = makeRef({ title: "Single", moods: ["여행"], scenes: [] });

    const out = recommendMusic([dual, single], { moods: ["여행"], scenes: ["여행"] });

    // both score identically — the duplicate tag must not double-count
    expect(out[0]!.score).toBe(out[1]!.score);
  });
});

describe("collectTags", () => {
  it("dedupes tags across the library, keeping first spelling", () => {
    const refs = [
      makeRef({ moods: ["잔잔한", "Lo-Fi"], scenes: ["오프닝"] }),
      makeRef({ moods: ["lo-fi", "신나는"], scenes: ["오프닝", "여행"] }),
    ];

    const tags = collectTags(refs);

    expect(tags.moods).toEqual(["잔잔한", "Lo-Fi", "신나는"]);
    expect(tags.scenes).toEqual(["오프닝", "여행"]);
  });

  it("collectAllTags merges moods and scenes into one deduped list", () => {
    const refs = [
      makeRef({ moods: ["여행"], scenes: ["오프닝"] }),
      makeRef({ moods: [], scenes: ["여행"] }),
    ];

    expect(collectAllTags(refs)).toEqual(["여행", "오프닝"]);
  });
});
