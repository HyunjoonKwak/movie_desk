import type { ID, MediaAsset, Ms } from "@movie-desk/core";
import { bestWindow } from "./interest";
import { MODE_PRESETS } from "./modes";
import { cosine } from "./semantic";
import type {
  AssetAnalysis,
  CutReason,
  EditMode,
  EditPlan,
  MusicAnalysis,
  PlanConstraints,
  PlanItem,
} from "./types";

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
  readonly faceArea?: number;
  readonly smile?: number;
  readonly golden?: boolean;
  readonly storyDay?: number;
  readonly storyPlace?: string;
}

export interface ChapterBreak {
  readonly label: string;
  readonly fromCapturedAt: number; // candidates at/after this time start the chapter
}

const DEDUP_COSINE = 0.8;

type RejectedCandidate = EditPlan["rejected"][number];

const sampleSignals = (
  analysis: AssetAnalysis | undefined,
  startMs: number,
  durationMs: number,
): Pick<Candidate, "faceArea" | "smile"> => {
  if (!analysis || analysis.samples.length === 0) return {};
  const inWindow = analysis.samples.filter(
    (sample) => sample.atMs >= startMs && sample.atMs <= startMs + durationMs,
  );
  const samples = inWindow.length > 0 ? inWindow : analysis.samples;
  const faceArea = Math.max(...samples.map((sample) => sample.faceArea ?? 0));
  const smile = Math.max(...samples.map((sample) => sample.smile ?? 0));
  return {
    ...(faceArea > 0 ? { faceArea } : {}),
    ...(smile > 0 ? { smile } : {}),
  };
};

// Build the chronological candidate pool + the rejected list (with reasons).
export const buildCandidates = (
  assets: readonly MediaAsset[],
  analyses: ReadonlyMap<ID, AssetAnalysis>,
  constraints: PlanConstraints,
  minWindowMs: number,
): { candidates: Candidate[]; rejected: RejectedCandidate[] } => {
  const rejected: RejectedCandidate[] = [];
  const candidates: Candidate[] = [];

  for (const asset of assets) {
    if (asset.kind === "audio") continue;
    if (constraints.excluded.includes(asset.id)) {
      rejected.push({ assetId: asset.id, atMs: 0, reasons: [{ code: "user-excluded" }] });
      continue;
    }
    const pinned = constraints.pinned.includes(asset.id);
    const a = analyses.get(asset.id);
    if (!a) {
      if (!pinned)
        rejected.push({ assetId: asset.id, atMs: 0, reasons: [{ code: "analysis-pending" }] });
      if (!pinned) continue;
    }
    const capturedAt = asset.capturedAt ?? asset.importedAt;
    const junk = a?.junk ?? [];
    if (junk.length > 0 && !pinned) {
      rejected.push({
        assetId: asset.id,
        atMs: 0,
        reasons: junk.map((code) => ({ code })),
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
        ...sampleSignals(a, 0, minWindowMs),
      });
      continue;
    }
    // videos: best window (+ a second, far-apart window for long clips),
    // constrained to the user-marked usable range when one is set.
    const rin = asset.useInMs ?? 0;
    const rout = asset.useOutMs ?? asset.durationMs;
    const rangeMs = Math.max(0, rout - rin);
    if (!a || a.samples.length === 0) {
      candidates.push({
        ...base,
        isPhoto: false,
        srcStartMs: rin,
        // Never invent source time. The assembler rejects an automatic
        // sub-400ms window and keeps a pinned one at its real duration.
        maxDurMs: rangeMs,
        score: 0.4,
      });
      continue;
    }
    const inRange = a.samples
      .map((s, i) => ({ s, interest: a.interest[i] ?? 0 }))
      .filter(({ s }) => s.atMs >= rin && s.atMs <= rout);
    const pool2 =
      inRange.length > 0 ? inRange : a.samples.map((s, i) => ({ s, interest: a.interest[i] ?? 0 }));
    const w1 = bestWindow(
      pool2.map((x) => x.s),
      pool2.map((x) => x.interest),
      minWindowMs,
    );
    const start1 = Math.max(rin, Math.min(w1.startMs, Math.max(rin, rout - minWindowMs)));
      candidates.push({
        ...base,
        isPhoto: false,
        srcStartMs: start1,
        maxDurMs: Math.max(0, rout - start1),
        score: w1.score,
        ...sampleSignals(a, start1, minWindowMs),
    });
    if (rangeMs > 20_000) {
      const subSamples = pool2.filter(({ s }) => Math.abs(s.atMs - start1) > rangeMs * 0.3);
      if (subSamples.length > 0) {
        const w2 = bestWindow(
          subSamples.map((x) => x.s),
          subSamples.map((x) => x.interest),
          minWindowMs,
        );
        const start2 = Math.max(rin, Math.min(w2.startMs, Math.max(rin, rout - minWindowMs)));
        candidates.push({
          ...base,
          isPhoto: false,
          srcStartMs: start2,
          maxDurMs: Math.max(0, rout - start2),
          score: w2.score * 0.9, // slight discount for second helpings
          ...sampleSignals(a, start2, minWindowMs),
        });
      }
    }
  }
  candidates.sort((x, y) => x.capturedAt - y.capturedAt || x.srcStartMs - y.srcStartMs);
  return { candidates, rejected };
};

// Beats-per-cut from local music energy (design: 에너지 높은 구간 = 빠른 컷).
const beatsForSlot = (energy: number, hi: number, mode: ReturnType<typeof presetOf>): number => {
  if (energy > hi * 0.75) return mode.beatsHigh;
  if (energy > hi * 0.35) return mode.beatsMid;
  return mode.beatsLow;
};

const presetOf = (mode: EditMode) => MODE_PRESETS[mode];

const scoreForMode = (candidate: Candidate, mode: ReturnType<typeof presetOf>): number => {
  const faceSignal = Math.max(candidate.smile ?? 0, Math.min(1, (candidate.faceArea ?? 0) / 0.2));
  const faceMultiplier = 1 + (mode.faceWeight - 1) * faceSignal;
  const wideBonus = mode.wideBonus * (1 - faceSignal);
  return Math.max(0, Math.min(1, candidate.score * faceMultiplier + wideBonus));
};

// Choose one representative from each visually similar group before the
// chronological assembly. This makes mode weights affect the actual draft,
// while the surviving shots still play in capture order. Pinned shots always
// survive and displace non-pinned duplicates.
const preparePool = (
  candidates: readonly Candidate[],
  mode: ReturnType<typeof presetOf>,
  rejected: RejectedCandidate[],
): Candidate[] => {
  const kept: Candidate[] = [];
  const rejectDuplicate = (candidate: Candidate): void => {
    rejected.push({
      assetId: candidate.assetId,
      atMs: candidate.srcStartMs,
      reasons: [{ code: "duplicate" }],
    });
  };

  for (const original of candidates) {
    const candidate = { ...original, score: scoreForMode(original, mode) };
    if (!candidate.embedding) {
      kept.push(candidate);
      continue;
    }
    const similarIndexes = kept.flatMap((item, index) =>
      item.embedding && cosine(item.embedding, candidate.embedding!) > DEDUP_COSINE ? [index] : [],
    );
    if (similarIndexes.length === 0) {
      kept.push(candidate);
      continue;
    }

    if (candidate.pinned) {
      for (const index of [...similarIndexes].reverse()) {
        const existing = kept[index]!;
        if (existing.pinned) continue;
        rejectDuplicate(existing);
        kept.splice(index, 1);
      }
      kept.push(candidate);
      continue;
    }
    if (similarIndexes.some((index) => kept[index]!.pinned)) {
      rejectDuplicate(candidate);
      continue;
    }

    const bestExistingIndex = similarIndexes.reduce((best, index) =>
      kept[index]!.score > kept[best]!.score ? index : best,
    );
    if (candidate.score <= kept[bestExistingIndex]!.score) {
      rejectDuplicate(candidate);
      continue;
    }
    for (const index of [...similarIndexes].reverse()) {
      rejectDuplicate(kept[index]!);
      kept.splice(index, 1);
    }
    kept.push(candidate);
  }

  return kept.sort((a, b) => a.capturedAt - b.capturedAt || a.srcStartMs - b.srcStartMs);
};

export interface AssembleInput {
  readonly mode: EditMode;
  readonly targetMs: Ms;
  readonly candidates: readonly Candidate[];
  readonly rejected: readonly RejectedCandidate[];
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
  const pool = preparePool(input.candidates, preset, rejected);

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
      rejected.push({
        assetId: next.assetId,
        atMs: next.srcStartMs,
        reasons: [{ code: "duplicate" }],
      });
      continue;
    }

    // Chapter break?
    let chapter: string | undefined;
    if (
      preset.chapters &&
      chapterIdx < chapters.length &&
      next.capturedAt >= chapters[chapterIdx]!.fromCapturedAt
    ) {
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
      const holdBeats =
        stackMates.length > 0 ? Math.max(0.5, preset.photoBeats / 2) : preset.photoBeats;
      const holdMs = Math.round(music ? holdBeats * beatMs : preset.fallbackCutMs);
      const run = [next, ...stackMates];
      for (const p of run) {
        usedWindows.add(`${p.assetId}:0`);
        items.push({
          assetId: p.assetId,
          isPhoto: true,
          srcStartMs: 0,
          durationMs: holdMs,
          reasons: buildReasons(p, energy, maxEnergy, run.length > 1),
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
    const nBeats = music ? beatsForSlot(energy, maxEnergy, preset) : 1;
    let durMs = Math.round(music ? nBeats * beatMs : preset.fallbackCutMs);
    // Heavy shake: usable only as a short transition (design: 4단계 정책).
    if (next.shakeTier === "heavy") durMs = Math.min(durMs, 800);
    durMs = Math.min(durMs, next.maxDurMs);
    // A pinned source keeps its real duration even below the normal 400ms
    // editorial minimum. Zero-length media still cannot form a clip.
    if (durMs <= 0 || (durMs < 400 && !next.pinned)) {
      rejected.push({
        assetId: next.assetId,
        atMs: next.srcStartMs,
        reasons: [{ code: "too-short" }],
      });
      continue;
    }
    usedWindows.add(key);
    items.push({
      assetId: next.assetId,
      isPhoto: false,
      srcStartMs: next.srcStartMs,
      durationMs: durMs,
      reasons: buildReasons(next, energy, maxEnergy),
      ...(chapter ? { chapter } : {}),
    });
    filledMs += durMs;
    beatIdx += nBeats;
    if (next.embedding) chosenEmbeddings.push(next.embedding);
  }

  for (const remaining of pool) {
    rejected.push({
      assetId: remaining.assetId,
      atMs: remaining.srcStartMs,
      reasons: [{ code: "target-filled" }],
    });
  }

  return {
    mode: input.mode,
    targetMs: input.targetMs,
    ...(music ? { musicAssetId: music.assetId } : {}),
    items,
    rejected,
  };
};

const buildReasons = (
  candidate: Candidate,
  energy: number,
  maxEnergy: number,
  photoStack = false,
): CutReason[] => {
  const reasons: CutReason[] = [];
  if (candidate.pinned) reasons.push({ code: "user-pinned" });
  if ((candidate.smile ?? 0) > 0.4) reasons.push({ code: "smile" });
  else if ((candidate.faceArea ?? 0) > 0.03) reasons.push({ code: "face" });
  if (candidate.golden) reasons.push({ code: "golden-hour" });
  if (candidate.storyDay) {
    reasons.push({
      code: "story-position",
      day: candidate.storyDay,
      ...(candidate.storyPlace ? { detail: candidate.storyPlace } : {}),
    });
  }
  if (candidate.tags && candidate.tags.length > 0) {
    reasons.push({ code: "semantic", detail: candidate.tags.slice(0, 2).join(" · ") });
  }
  if (photoStack) reasons.push({ code: "photo-stack" });
  if (energy > maxEnergy * 0.75) reasons.push({ code: "music-energy" });
  if (candidate.shakeTier === "heavy") reasons.push({ code: "heavy-shake-transition" });
  if (candidate.shakeTier === "mild") reasons.push({ code: "mild-shake" });
  reasons.push({ code: "interest", score: candidate.score * 100 });
  return reasons;
};
