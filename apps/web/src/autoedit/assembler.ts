import type { ID, MediaAsset, Ms } from "@movie-desk/core";
import { bestWindow } from "./interest";
import { MODE_PRESETS } from "./modes";
import { cosine } from "./semantic";
import type { AssetAnalysis, EditMode, EditPlan, MusicAnalysis, PlanConstraints, PlanItem } from "./types";

// One selectable moment. Videos may contribute up to two windows; photos one.
export interface Candidate {
  readonly assetId: ID;
  readonly isPhoto: boolean;
  readonly srcStartMs: Ms;
  readonly maxDurMs: Ms; // how much source is available from srcStartMs
  readonly score: number;
  readonly capturedAt: number;
  readonly shakeTier: AssetAnalysis["shakeTier"];
  readonly pinned: boolean;
  readonly embedding?: Float32Array;
  readonly tags?: readonly string[];
}

export interface ChapterBreak {
  readonly label: string;
  readonly fromCapturedAt: number; // candidates at/after this time start the chapter
}

const DEDUP_COSINE = 0.8;

// Build the chronological candidate pool + the rejected list (with reasons).
export const buildCandidates = (
  assets: readonly MediaAsset[],
  analyses: ReadonlyMap<ID, AssetAnalysis>,
  constraints: PlanConstraints,
  minWindowMs: number,
): { candidates: Candidate[]; rejected: { assetId: ID; atMs: Ms; reason: string }[] } => {
  const rejected: { assetId: ID; atMs: Ms; reason: string }[] = [];
  const candidates: Candidate[] = [];
  const junkLabel: Record<string, string> = {
    blur: "초점이 흐림",
    underexposed: "너무 어두움",
    overexposed: "노출 과다",
    flat: "화면 정보 없음(가림/단색)",
    "too-short": "너무 짧음",
    shake: "심한 흔들림",
  };

  for (const asset of assets) {
    if (asset.kind === "audio") continue;
    if (constraints.excluded.includes(asset.id)) {
      rejected.push({ assetId: asset.id, atMs: 0, reason: "사용자 제외" });
      continue;
    }
    const pinned = constraints.pinned.includes(asset.id);
    const a = analyses.get(asset.id);
    if (!a) {
      if (!pinned) rejected.push({ assetId: asset.id, atMs: 0, reason: "분석 대기 중" });
      if (!pinned) continue;
    }
    const capturedAt = asset.capturedAt ?? asset.importedAt;
    const junk = a?.junk ?? [];
    if (junk.length > 0 && !pinned) {
      rejected.push({
        assetId: asset.id,
        atMs: 0,
        reason: junk.map((j) => junkLabel[j] ?? j).join(", "),
      });
      continue;
    }
    const base = {
      assetId: asset.id,
      capturedAt,
      pinned,
      shakeTier: a?.shakeTier ?? "stable",
      ...(a?.embedding ? { embedding: a.embedding } : {}),
      ...(a?.semanticTags ? { tags: a.semanticTags } : {}),
    };
    if (asset.kind === "image") {
      candidates.push({
        ...base,
        isPhoto: true,
        srcStartMs: 0,
        maxDurMs: 0,
        score: a ? Math.max(...a.interest, 0) : 0.5,
      });
      continue;
    }
    // videos: best window (+ a second, far-apart window for long clips),
    // constrained to the user-marked usable range when one is set.
    const rin = asset.useInMs ?? 0;
    const rout = asset.useOutMs ?? asset.durationMs;
    const rangeMs = Math.max(0, rout - rin);
    if (!a || a.samples.length === 0) {
      candidates.push({ ...base, isPhoto: false, srcStartMs: rin, maxDurMs: Math.max(500, rangeMs), score: 0.4 });
      continue;
    }
    const inRange = a.samples
      .map((s, i) => ({ s, interest: a.interest[i] ?? 0 }))
      .filter(({ s }) => s.atMs >= rin && s.atMs <= rout);
    const pool2 = inRange.length > 0 ? inRange : a.samples.map((s, i) => ({ s, interest: a.interest[i] ?? 0 }));
    const w1 = bestWindow(pool2.map((x) => x.s), pool2.map((x) => x.interest), minWindowMs);
    const start1 = Math.max(rin, Math.min(w1.startMs, Math.max(rin, rout - minWindowMs)));
    candidates.push({
      ...base,
      isPhoto: false,
      srcStartMs: start1,
      maxDurMs: Math.max(500, rout - start1),
      score: w1.score,
    });
    if (rangeMs > 20_000) {
      const subSamples = pool2.filter(({ s }) => Math.abs(s.atMs - start1) > rangeMs * 0.3);
      if (subSamples.length > 0) {
        const w2 = bestWindow(subSamples.map((x) => x.s), subSamples.map((x) => x.interest), minWindowMs);
        const start2 = Math.max(rin, Math.min(w2.startMs, Math.max(rin, rout - minWindowMs)));
        candidates.push({
          ...base,
          isPhoto: false,
          srcStartMs: start2,
          maxDurMs: Math.max(500, rout - start2),
          score: w2.score * 0.9, // slight discount for second helpings
        });
      }
    }
  }
  candidates.sort((x, y) => x.capturedAt - y.capturedAt || x.srcStartMs - y.srcStartMs);
  return { candidates, rejected };
};

// Beats-per-cut from local music energy (design: 에너지 높은 구간 = 빠른 컷).
const beatsForSlot = (
  energy: number,
  hi: number,
  mode: ReturnType<typeof presetOf>,
): number => {
  if (energy > hi * 0.75) return mode.beatsHigh;
  if (energy > hi * 0.35) return mode.beatsMid;
  return mode.beatsLow;
};

const presetOf = (mode: EditMode) => MODE_PRESETS[mode];

export interface AssembleInput {
  readonly mode: EditMode;
  readonly targetMs: Ms;
  readonly candidates: readonly Candidate[];
  readonly rejected: readonly { assetId: ID; atMs: Ms; reason: string }[];
  readonly music?: MusicAnalysis;
  readonly chapters?: readonly ChapterBreak[];
}

// The core assembly: chronological greedy fill over the beat grid with
// diversity/dedup constraints, photo interleave, and Ken Burns assignment.
export const assemble = (input: AssembleInput): EditPlan => {
  const preset = presetOf(input.mode);
  const { music } = input;
  const beatMs = music && music.bpm > 0 ? 60000 / music.bpm : preset.fallbackCutMs;
  const maxEnergy = music ? Math.max(0.0001, ...music.energyPerBeat) : 1;

  const items: PlanItem[] = [];
  const rejected = [...input.rejected];
  const chosenEmbeddings: Float32Array[] = [];
  const usedWindows = new Set<string>();
  let kenIdx = 0;
  const kenCycle = ["in", "out", "pan-l", "pan-r"] as const;
  let filledMs = 0;
  let beatIdx = 0;
  let chapterIdx = 0;
  const chapters = [...(input.chapters ?? [])].sort((a, b) => a.fromCapturedAt - b.fromCapturedAt);

  // Photos coming < 60s apart form stacks when the mode allows it.
  const pool = [...input.candidates];

  const tooSimilar = (c: Candidate): boolean => {
    if (!c.embedding) return false;
    return chosenEmbeddings.some((e) => cosine(e, c.embedding!) > DEDUP_COSINE);
  };

  const slotEnergy = (): number => {
    if (!music) return 0.5 * maxEnergy;
    return music.energyPerBeat[Math.min(beatIdx, music.energyPerBeat.length - 1)] ?? 0;
  };

  while (filledMs < input.targetMs && pool.length > 0) {
    const next = pool.shift()!;
    const key = `${next.assetId}:${next.srcStartMs}`;
    if (usedWindows.has(key)) continue;

    if (!next.pinned && tooSimilar(next)) {
      rejected.push({ assetId: next.assetId, atMs: next.srcStartMs, reason: "비슷한 장면이 이미 선택됨" });
      continue;
    }

    // Chapter break?
    let chapter: string | undefined;
    if (preset.chapters && chapterIdx < chapters.length && next.capturedAt >= chapters[chapterIdx]!.fromCapturedAt) {
      chapter = chapters[chapterIdx]!.label;
      chapterIdx++;
    }

    const energy = slotEnergy();
    if (next.isPhoto) {
      // Photo stack: on an energy peak, run this photo + up to 4 more photos
      // captured within 60s, each half the photo hold.
      const stackMates: Candidate[] = [];
      if (preset.photoStacks && energy > maxEnergy * 0.7) {
        for (let i = 0; i < pool.length && stackMates.length < 4; ) {
          const p = pool[i]!;
          if (p.isPhoto && Math.abs(p.capturedAt - next.capturedAt) < 60_000 && !p.pinned) {
            stackMates.push(p);
            pool.splice(i, 1);
          } else i++;
        }
      }
      const holdBeats = stackMates.length > 0 ? Math.max(0.5, preset.photoBeats / 2) : preset.photoBeats;
      const holdMs = Math.round(holdBeats * beatMs);
      const run = [next, ...stackMates];
      for (const p of run) {
        usedWindows.add(`${p.assetId}:0`);
        items.push({
          assetId: p.assetId,
          isPhoto: true,
          srcStartMs: 0,
          durationMs: holdMs,
          reason:
            run.length > 1
              ? "에너지 피크 포토 스택"
              : `사진 · 품질 ${(p.score * 100).toFixed(0)}점${p.pinned ? " · 사용자 지정" : ""}`,
          kenBurns: kenCycle[kenIdx++ % kenCycle.length]!,
          ...(chapter ? { chapter } : {}),
        });
        chapter = undefined;
        filledMs += holdMs;
        beatIdx += Math.max(1, Math.round(holdBeats));
        if (p.embedding) chosenEmbeddings.push(p.embedding);
      }
      continue;
    }

    // Video slot.
    const nBeats = beatsForSlot(energy, maxEnergy, preset);
    let durMs = Math.round(nBeats * beatMs);
    // Heavy shake: usable only as a short transition (design: 4단계 정책).
    if (next.shakeTier === "heavy") durMs = Math.min(durMs, 800);
    durMs = Math.min(durMs, next.maxDurMs);
    if (durMs < 400) {
      rejected.push({ assetId: next.assetId, atMs: next.srcStartMs, reason: "남은 구간이 너무 짧음" });
      continue;
    }
    usedWindows.add(key);
    items.push({
      assetId: next.assetId,
      isPhoto: false,
      srcStartMs: next.srcStartMs,
      durationMs: durMs,
      reason: buildReason(next, energy, maxEnergy),
      ...(chapter ? { chapter } : {}),
    });
    filledMs += durMs;
    beatIdx += nBeats;
    if (next.embedding) chosenEmbeddings.push(next.embedding);
  }

  return {
    mode: input.mode,
    targetMs: input.targetMs,
    ...(music ? { musicAssetId: music.assetId } : {}),
    items,
    rejected,
  };
};

const buildReason = (c: Candidate, energy: number, maxEnergy: number): string => {
  const bits: string[] = [];
  if (c.pinned) bits.push("사용자 지정");
  bits.push(`흥미도 ${(c.score * 100).toFixed(0)}점`);
  if (c.tags && c.tags.length > 0) bits.push(c.tags.slice(0, 2).join("·"));
  if (energy > maxEnergy * 0.75) bits.push("고에너지 구간 배치");
  if (c.shakeTier === "heavy") bits.push("흔들림 → 짧은 전환용");
  if (c.shakeTier === "mild") bits.push("약한 흔들림(안정화 권장)");
  return bits.join(" · ");
};
