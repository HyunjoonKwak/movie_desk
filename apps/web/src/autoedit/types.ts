import type { ID, Ms } from "@movie-desk/core";

// Shake tiers drive how a segment may be used (design: 흔들림 4단계 정책).
export type ShakeTier = "stable" | "mild" | "heavy" | "reject";

// Why a sampled window (or whole asset) was rejected by the junk filter.
export type JunkReason =
  | "blur"
  | "underexposed"
  | "overexposed"
  | "flat" // lens covered / featureless (low entropy + low variance)
  | "too-short"
  | "shake";

// Per-sample analysis for one point in time within an asset.
export interface FrameSample {
  readonly atMs: Ms; // source-relative
  readonly blurVar: number; // variance of Laplacian (higher = sharper)
  readonly exposureLow: number; // fraction of crushed luma pixels [0..1]
  readonly exposureHigh: number; // fraction of blown luma pixels [0..1]
  readonly entropy: number; // luma histogram entropy (bits)
  readonly motion: number; // mean abs luma diff vs previous sample [0..1]
  readonly smile?: number; // P4: max smile blendshape [0..1]
  readonly faceArea?: number; // P4: largest face box area fraction [0..1]
  readonly faceCx?: number; // P4/P6: largest face centre x [0..1]
}

// Whole-asset analysis result cached by the background analyzer.
export interface AssetAnalysis {
  readonly assetId: ID;
  readonly kind: "video" | "audio" | "image";
  readonly durationMs: Ms;
  readonly samples: readonly FrameSample[];
  readonly audioRms?: readonly number[]; // per-second RMS envelope [0..1]
  readonly shakeTier: ShakeTier;
  readonly junk: readonly JunkReason[]; // non-empty = excluded by default
  // Composite per-sample interest [0..1], same indices as `samples`.
  readonly interest: readonly number[];
  readonly quality: number; // overall usable-quality score [0..1]
  readonly embedding?: Float32Array; // P5: CLIP embedding of the best frame
  readonly semanticTags?: readonly string[]; // P5: top prompt-bank matches
  readonly aesthetic?: number; // P5: LAION head score normalised [0..1]
}

export type AnalysisStatus = "pending" | "running" | "done" | "failed";

export interface AnalysisEntry {
  readonly status: AnalysisStatus;
  readonly progress: number; // 0..1
  readonly result?: AssetAnalysis;
  readonly error?: string;
}

// Music analysis on top of the existing beat detector.
export interface MusicAnalysis {
  readonly assetId: ID;
  readonly durationMs: Ms;
  readonly beats: readonly Ms[]; // beat times
  readonly bpm: number;
  readonly energyPerBeat: readonly number[]; // RMS per beat interval [0..1]
  // Section boundaries from novelty (phrase boundaries usable for trim/loop).
  readonly sections: readonly Ms[];
}

export type EditMode =
  | "highlight" // 감성 하이라이트 1–3분
  | "record" // 여행 기록 3–8분
  | "shorts" // 쇼츠 30–60초 9:16
  | "growth" // 성장 기록 (인물 중심)
  | "scenic"; // 풍경 시네마틱

// Stable, locale-independent explanation of an automatic cut decision.
// UI copy is derived from these codes so a saved plan never mixes languages.
export type CutReasonCode =
  | "user-pinned"
  | "interest"
  | "semantic"
  | "face"
  | "smile"
  | "golden-hour"
  | "music-energy"
  | "heavy-shake-transition"
  | "mild-shake"
  | "photo-stack"
  | "story-position"
  | "map-transition"
  | "user-excluded"
  | "analysis-pending"
  | "blur"
  | "underexposed"
  | "overexposed"
  | "flat"
  | "too-short"
  | "shake"
  | "duplicate"
  | "target-filled";

export interface CutReason {
  readonly code: CutReasonCode;
  readonly score?: number;
  readonly day?: number;
  readonly detail?: string;
}

// A concrete cut decision in the generated plan.
export interface PlanItem {
  readonly assetId: ID;
  readonly isPhoto: boolean;
  readonly srcStartMs: Ms; // trim-in within the source (0 for photos)
  readonly durationMs: Ms; // timeline duration
  readonly reasons: readonly CutReason[]; // explainable, localizable draft decision
  readonly kenBurns?: "in" | "out" | "pan-l" | "pan-r"; // photos only
  readonly chapter?: string; // starts a new chapter (place/day label)
}

export interface EditPlan {
  readonly mode: EditMode;
  readonly targetMs: Ms;
  readonly musicAssetId?: ID;
  readonly items: readonly PlanItem[];
  // Candidates that lost — shown in the 탈락 후보 브라우저 with reasons.
  readonly rejected: readonly { assetId: ID; atMs: Ms; reasons: readonly CutReason[] }[];
}

// User constraints gathered in the review step (⑤).
export interface PlanConstraints {
  readonly pinned: readonly ID[]; // must include these assets
  readonly excluded: readonly ID[]; // never include these assets
}
