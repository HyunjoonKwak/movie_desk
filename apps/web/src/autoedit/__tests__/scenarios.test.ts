import type { ID, MediaAsset } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { assemble, buildCandidates, type Candidate } from "../assembler";
import type { AssetAnalysis, MusicAnalysis } from "../types";

const candidate = (id: string, capturedAt: number, over: Partial<Candidate> = {}): Candidate => ({
  assetId: id as ID,
  isPhoto: false,
  srcStartMs: 0,
  maxDurMs: 8_000,
  score: 0.6,
  capturedAt,
  shakeTier: "stable",
  pinned: false,
  ...over,
});

const music: MusicAnalysis = {
  assetId: "music" as ID,
  durationMs: 30_000,
  beats: Array.from({ length: 60 }, (_, index) => index * 500),
  bpm: 120,
  energyPerBeat: Array.from({ length: 60 }, () => 0.4),
  sections: [0, 15_000],
};

describe("fixed auto-edit scenarios", () => {
  it("keeps both photos and videos in a mixed-source record", () => {
    const plan = assemble({
      mode: "record",
      targetMs: 4_000,
      candidates: [candidate("photo", 1, { isPhoto: true, maxDurMs: 0 }), candidate("video", 2)],
      rejected: [],
      music,
    });

    expect(plan.items.map((item) => item.assetId)).toEqual(["photo", "video"]);
    expect(plan.items[0]).toMatchObject({ isPhoto: true, kenBurns: "in" });
    expect(plan.items[1]).toMatchObject({ isPhoto: false });
  });

  it("uses the mode's cut duration directly when there is no music grid", () => {
    const plan = assemble({
      mode: "highlight",
      targetMs: 2_500,
      candidates: [candidate("video", 1)],
      rejected: [],
    });

    expect(plan.musicAssetId).toBeUndefined();
    expect(plan.items[0]!.durationMs).toBe(2_500);
  });

  it("keeps a pinned short source without stretching it past its real duration", () => {
    const shortAsset = {
      id: "short" as ID,
      name: "short.mp4",
      kind: "video",
      mime: "video/mp4",
      durationMs: 300,
      opfsPath: "short__x",
      importedAt: 1,
    } as MediaAsset;
    const shortAnalysis: AssetAnalysis = {
      assetId: shortAsset.id,
      kind: "video",
      durationMs: 300,
      samples: [
        {
          atMs: 0,
          blurVar: 100,
          exposureLow: 0,
          exposureHigh: 0,
          entropy: 6,
          motion: 0,
        },
      ],
      shakeTier: "stable",
      junk: ["too-short"],
      interest: [0.8],
      quality: 0.8,
    };

    for (const analyses of [
      new Map<ID, AssetAnalysis>(),
      new Map<ID, AssetAnalysis>([[shortAsset.id, shortAnalysis]]),
    ]) {
      const { candidates, rejected } = buildCandidates(
        [shortAsset],
        analyses,
        { pinned: [shortAsset.id], excluded: [] },
        1_200,
      );
      const plan = assemble({ mode: "highlight", targetMs: 2_500, candidates, rejected });

      expect(candidates[0]!.maxDurMs).toBe(300);
      expect(plan.items[0]).toMatchObject({ assetId: shortAsset.id, durationMs: 300 });
      expect(plan.items[0]!.reasons).toContainEqual({ code: "user-pinned" });
    }
  });

  it("uses growth-mode face weight to keep the best shot in a duplicate-heavy set", () => {
    const same = Float32Array.from([1, 0, 0]);
    const plan = assemble({
      mode: "growth",
      targetMs: 6_000,
      candidates: [
        candidate("wide-duplicate", 1, { score: 0.75, embedding: same }),
        candidate("face-best", 2, { score: 0.6, faceArea: 0.2, embedding: same }),
        candidate("face-duplicate", 3, {
          score: 0.55,
          faceArea: 0.1,
          embedding: Float32Array.from([0.99, 0.01, 0]),
        }),
        candidate("unique", 4, {
          score: 0.4,
          embedding: Float32Array.from([0, 1, 0]),
        }),
      ],
      rejected: [],
    });

    expect(plan.items.map((item) => item.assetId)).toEqual(["face-best", "unique"]);
    expect(plan.items[0]!.reasons).toEqual(
      expect.arrayContaining([{ code: "face" }, { code: "interest", score: 96 }]),
    );
    expect(
      plan.rejected.filter((item) => item.reasons.some((reason) => reason.code === "duplicate")),
    ).toHaveLength(2);
  });
});
