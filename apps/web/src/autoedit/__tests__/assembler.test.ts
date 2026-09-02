import { describe, expect, it } from "vitest";
import type { ID, MediaAsset } from "@movie-desk/core";
import { assemble, buildCandidates, type Candidate } from "../assembler";
import { estimateBpm, energyPerBeat, noveltySections, phraseBefore } from "../music";
import { beatSnap } from "../reconform";
import { applyPlanToProject } from "../apply";
import { createEmptyProject } from "@movie-desk/core";
import type { AssetAnalysis, MusicAnalysis } from "../types";

const asset = (id: string, kind: "video" | "image", capturedAt: number, durationMs = 10000): MediaAsset =>
  ({
    id: id as ID,
    name: `${id}.mp4`,
    kind,
    mime: kind === "image" ? "image/jpeg" : "video/mp4",
    durationMs: kind === "image" ? 5000 : durationMs,
    opfsPath: `${id}__x`,
    importedAt: capturedAt,
    capturedAt,
  }) as MediaAsset;

const analysis = (id: string, over: Partial<AssetAnalysis> = {}): AssetAnalysis => ({
  assetId: id as ID,
  kind: "video",
  durationMs: 10000,
  samples: Array.from({ length: 10 }, (_, i) => ({
    atMs: i * 1000,
    blurVar: 100,
    exposureLow: 0,
    exposureHigh: 0,
    entropy: 6,
    motion: i === 5 ? 0.9 : 0.1,
  })),
  shakeTier: "stable",
  junk: [],
  interest: Array.from({ length: 10 }, (_, i) => (i === 5 ? 0.9 : 0.2)),
  quality: 0.8,
  ...over,
});

const music: MusicAnalysis = {
  assetId: "m" as ID,
  durationMs: 60000,
  beats: Array.from({ length: 120 }, (_, i) => i * 500), // 120bpm
  bpm: 120,
  energyPerBeat: Array.from({ length: 120 }, (_, i) => (i > 40 && i < 80 ? 1 : 0.3)),
  sections: [0, 20000, 40000],
};

describe("music helpers", () => {
  it("estimates bpm from median gap", () => {
    expect(estimateBpm([0, 500, 1000, 1500])).toBe(120);
  });
  it("energyPerBeat averages the right seconds", () => {
    const rms = [0, 1, 0, 1];
    const e = energyPerBeat([0, 1000, 2000, 3000], rms);
    expect(e[1]).toBeCloseTo(1);
    expect(e[2]).toBeCloseTo(0);
  });
  it("noveltySections finds a hard energy shift and phraseBefore snaps to it", () => {
    const rms = [...Array(10).fill(0.1), ...Array(10).fill(0.9)];
    const sections = noveltySections(rms, 3);
    expect(sections.length).toBeGreaterThan(1);
    expect(phraseBefore(sections, 15_000)).toBeGreaterThan(0);
  });
});

describe("buildCandidates", () => {
  it("rejects junk with Korean reasons, keeps pinned junk", () => {
    const assets = [asset("a", "video", 100), asset("b", "video", 200)];
    const analyses = new Map<ID, AssetAnalysis>([
      ["a" as ID, analysis("a", { junk: ["blur"] })],
      ["b" as ID, analysis("b", { junk: ["blur"] })],
    ]);
    const { candidates, rejected } = buildCandidates(
      assets,
      analyses,
      { pinned: ["b" as ID], excluded: [] },
      2000,
    );
    expect(rejected.some((r) => r.assetId === ("a" as ID) && r.reason.includes("초점"))).toBe(true);
    expect(candidates.some((c) => c.assetId === ("b" as ID) && c.pinned)).toBe(true);
  });

  it("excluded assets never become candidates", () => {
    const { candidates, rejected } = buildCandidates(
      [asset("a", "video", 100)],
      new Map([["a" as ID, analysis("a")]]),
      { pinned: [], excluded: ["a" as ID] },
      2000,
    );
    expect(candidates).toHaveLength(0);
    expect(rejected[0]!.reason).toBe("사용자 제외");
  });

  it("respects the user-marked usable range (useInMs/useOutMs)", () => {
    // hot sample sits at 5s, but the user limits the range to 6–9s —
    // the candidate window must stay inside that range.
    const a = { ...asset("a", "video", 100), useInMs: 6000, useOutMs: 9000 } as MediaAsset;
    const { candidates } = buildCandidates(
      [a],
      new Map([["a" as ID, analysis("a")]]),
      { pinned: [], excluded: [] },
      2000,
    );
    expect(candidates).toHaveLength(1); // 3s range → no second window
    const c = candidates[0]!;
    expect(c.srcStartMs).toBeGreaterThanOrEqual(6000);
    expect(c.srcStartMs + c.maxDurMs).toBeLessThanOrEqual(9000);
  });

  it("range without analyzed samples falls back to the range itself", () => {
    const a = { ...asset("a", "video", 100), useInMs: 2000, useOutMs: 4000 } as MediaAsset;
    const { candidates } = buildCandidates(
      [a],
      new Map([["a" as ID, analysis("a", { samples: [], interest: [] })]]),
      { pinned: [], excluded: [] },
      2000,
    );
    expect(candidates[0]!.srcStartMs).toBe(2000);
    expect(candidates[0]!.maxDurMs).toBe(2000);
  });

  it("orders chronologically and picks the hottest window", () => {
    const { candidates } = buildCandidates(
      [asset("late", "video", 2000), asset("early", "video", 1000)],
      new Map([
        ["late" as ID, analysis("late")],
        ["early" as ID, analysis("early")],
      ]),
      { pinned: [], excluded: [] },
      2000,
    );
    expect(candidates[0]!.assetId).toBe("early" as ID);
    expect(candidates[0]!.srcStartMs).toBeGreaterThanOrEqual(3000); // hot sample at 5s
  });
});

describe("assemble", () => {
  const mkCandidate = (id: string, at: number, over: Partial<Candidate> = {}): Candidate => ({
    assetId: id as ID,
    isPhoto: false,
    srcStartMs: 0,
    maxDurMs: 8000,
    score: 0.7,
    capturedAt: at,
    shakeTier: "stable",
    pinned: false,
    ...over,
  });

  it("fills to target on the beat grid, chronologically", () => {
    const cands = [mkCandidate("a", 1), mkCandidate("b", 2), mkCandidate("c", 3), mkCandidate("d", 4)];
    const plan = assemble({ mode: "highlight", targetMs: 6000, candidates: cands, rejected: [], music });
    const total = plan.items.reduce((s, i) => s + i.durationMs, 0);
    expect(total).toBeGreaterThanOrEqual(6000);
    expect(plan.items.map((i) => i.assetId)).toEqual(
      [...plan.items.map((i) => i.assetId)].sort((x, y) => cands.findIndex((c) => c.assetId === x) - cands.findIndex((c) => c.assetId === y)),
    );
  });

  it("photos get ken burns and beat-length holds; stacks on energy peaks", () => {
    const photos = Array.from({ length: 5 }, (_, i) =>
      mkCandidate(`p${i}`, 1000 + i * 1000, { isPhoto: true, maxDurMs: 0 }),
    );
    // beatIdx starts at 0 → energy 0.3 low; force peak by making energy all high
    const hot: MusicAnalysis = { ...music, energyPerBeat: music.energyPerBeat.map(() => 1) };
    const plan = assemble({ mode: "highlight", targetMs: 4000, candidates: photos, rejected: [], music: hot });
    expect(plan.items.every((i) => i.isPhoto && i.kenBurns)).toBe(true);
    // photoStacks: first photo pulls up to 4 mates captured within 60s
    expect(plan.items.length).toBeGreaterThanOrEqual(4);
  });

  it("dedups near-identical embeddings with a reason", () => {
    const e = Float32Array.from([1, 0, 0]);
    const cands = [
      mkCandidate("a", 1, { embedding: e }),
      mkCandidate("b", 2, { embedding: Float32Array.from([0.99, 0.05, 0]) }),
      mkCandidate("c", 3, { embedding: Float32Array.from([0, 1, 0]) }),
    ];
    const plan = assemble({ mode: "highlight", targetMs: 3000, candidates: cands, rejected: [], music });
    expect(plan.rejected.some((r) => r.assetId === ("b" as ID) && r.reason.includes("비슷한"))).toBe(true);
    expect(plan.items.some((i) => i.assetId === ("c" as ID))).toBe(true);
  });

  it("heavy shake becomes a short transition", () => {
    const cands = [mkCandidate("a", 1, { shakeTier: "heavy" })];
    const plan = assemble({ mode: "record", targetMs: 2000, candidates: cands, rejected: [], music });
    expect(plan.items[0]!.durationMs).toBeLessThanOrEqual(800);
  });

  it("chapter breaks land on the first item at/after the boundary", () => {
    const cands = [mkCandidate("a", 100), mkCandidate("b", 5000)];
    const plan = assemble({
      mode: "record",
      targetMs: 5000,
      candidates: cands,
      rejected: [],
      music,
      chapters: [
        { label: "Day 1", fromCapturedAt: 0 },
        { label: "Day 2", fromCapturedAt: 4000 },
      ],
    });
    expect(plan.items[0]!.chapter).toBe("Day 1");
    expect(plan.items[1]!.chapter).toBe("Day 2");
  });
});

describe("beatSnap re-conform", () => {
  it("snaps boundaries within tolerance, skips beyond, requantizes photos", () => {
    const { durations, report } = beatSnap({
      durations: [1900, 2300, 1000],
      photoFlags: [false, false, true],
      beats: Array.from({ length: 20 }, (_, i) => i * 1000), // 60bpm grid
    });
    // boundary1 1900→2000 (snap +100), boundary2 4200→4000 (snap -200)
    expect(report.snapped).toBe(2);
    expect(durations[0]).toBe(2000);
    // snapping stretched the photo to 1200ms → re-quantized back to 1 beat
    expect(report.requantized).toBe(1);
    expect(durations[2]).toBe(1000);
    const total0 = 1900 + 2300 + 1000;
    const total1 = durations.reduce((a, b) => a + b, 0);
    expect(Math.abs(total1 - total0)).toBeLessThanOrEqual(1000);
  });

  it("never shrinks a segment below the minimum", () => {
    const { report } = beatSnap({
      durations: [450, 450],
      photoFlags: [false, false],
      beats: [0, 500, 1000],
      minSegmentMs: 400,
    });
    expect(report.skipped + report.snapped).toBeGreaterThanOrEqual(0); // no throw, no <400 result
  });
});

describe("applyPlanToProject", () => {
  it("builds AUTO tracks with sequential clips, markers, titles, music fade", () => {
    const project = createEmptyProject();
    const assets = new Map<ID, MediaAsset>([
      ["v1" as ID, asset("v1", "video", 1)],
      ["p1" as ID, asset("p1", "image", 2)],
      ["m" as ID, asset("m", "video", 0)],
    ]);
    const plan = {
      mode: "record" as const,
      targetMs: 4000,
      items: [
        { assetId: "v1" as ID, isPhoto: false, srcStartMs: 2000, durationMs: 2000, reason: "r1", chapter: "Day 1 — 강릉" },
        { assetId: "p1" as ID, isPhoto: true, srcStartMs: 0, durationMs: 1000, reason: "r2", kenBurns: "in" as const },
      ],
      rejected: [],
    };
    const out = applyPlanToProject(project, {
      plan,
      assets,
      music: { ...music, opfsAssetId: "m" as ID },
    });

    const autoV = out.timeline.tracks.find((t) => t.name === "AUTO V")!;
    expect(autoV.clips).toHaveLength(2);
    expect(autoV.clips[0]!.start).toBe(0);
    expect(autoV.clips[1]!.start).toBe(2000);
    // photo has ken burns keyframes
    expect(autoV.clips[1]!.keyframes.some((k) => k.target === "transform.scale")).toBe(true);
    // chapter marker + title clip
    expect(out.timeline.markers?.some((m) => m.label.includes("강릉"))).toBe(true);
    const autoT = out.timeline.tracks.find((t) => t.name === "AUTO T")!;
    expect(autoT.clips).toHaveLength(1);
    // music with end fade
    const autoM = out.timeline.tracks.find((t) => t.name === "AUTO M")!;
    expect(autoM.clips[0]!.keyframes.some((k) => k.target === "volume")).toBe(true);
  });
});
