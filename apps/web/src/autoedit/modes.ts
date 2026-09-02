import type { EditMode } from "./types";

// Mode presets — the five styles from the design doc. Values are the knobs
// the assembler reads; everything else derives from these.
export interface ModePreset {
  readonly mode: EditMode;
  readonly label: string;
  readonly targetRangeMs: readonly [number, number];
  readonly defaultTargetMs: number;
  // Beats per cut by music-energy tier (high/mid/low). No-music fallback uses
  // fallbackCutMs.
  readonly beatsHigh: number;
  readonly beatsMid: number;
  readonly beatsLow: number;
  readonly fallbackCutMs: number;
  readonly photoBeats: number; // photo hold length in beats
  readonly photoStacks: boolean; // rapid photo runs on energy peaks
  readonly kenBurns: boolean;
  readonly chapters: boolean; // place/day title cards + markers
  readonly faceWeight: number; // extra interest multiplier for facey samples
  readonly wideBonus: number; // bonus for low-face scenic shots
  readonly keepNaturalAudio: boolean; // clip volume kept (vs muted under music)
  readonly aspect: "16:9" | "9:16";
  readonly yalKeywords: readonly string[]; // ③단계 YAL 검색 힌트
}

export const MODE_PRESETS: Record<EditMode, ModePreset> = {
  highlight: {
    mode: "highlight",
    label: "감성 하이라이트",
    targetRangeMs: [60_000, 180_000],
    defaultTargetMs: 120_000,
    beatsHigh: 1,
    beatsMid: 2,
    beatsLow: 4,
    fallbackCutMs: 2500,
    photoBeats: 1,
    photoStacks: true,
    kenBurns: true,
    chapters: false,
    faceWeight: 1.2,
    wideBonus: 0.1,
    keepNaturalAudio: false,
    aspect: "16:9",
    yalKeywords: ["Cinematic", "Ambient", "Calm"],
  },
  record: {
    mode: "record",
    label: "여행 기록",
    targetRangeMs: [180_000, 480_000],
    defaultTargetMs: 300_000,
    beatsHigh: 2,
    beatsMid: 4,
    beatsLow: 4,
    fallbackCutMs: 3500,
    photoBeats: 2,
    photoStacks: false,
    kenBurns: true,
    chapters: true,
    faceWeight: 1.1,
    wideBonus: 0.05,
    keepNaturalAudio: true,
    aspect: "16:9",
    yalKeywords: ["Happy", "Acoustic", "Bright"],
  },
  shorts: {
    mode: "shorts",
    label: "쇼츠",
    targetRangeMs: [30_000, 60_000],
    defaultTargetMs: 45_000,
    beatsHigh: 1,
    beatsMid: 1,
    beatsLow: 2,
    fallbackCutMs: 1500,
    photoBeats: 1,
    photoStacks: true,
    kenBurns: true,
    chapters: false,
    faceWeight: 1.2,
    wideBonus: 0,
    keepNaturalAudio: false,
    aspect: "9:16",
    yalKeywords: ["Dance & Electronic", "Upbeat"],
  },
  growth: {
    mode: "growth",
    label: "성장 기록",
    targetRangeMs: [120_000, 300_000],
    defaultTargetMs: 180_000,
    beatsHigh: 2,
    beatsMid: 2,
    beatsLow: 4,
    fallbackCutMs: 3000,
    photoBeats: 2,
    photoStacks: false,
    kenBurns: true,
    chapters: true,
    faceWeight: 1.6,
    wideBonus: 0,
    keepNaturalAudio: true,
    aspect: "16:9",
    yalKeywords: ["Family", "Warm", "Acoustic"],
  },
  scenic: {
    mode: "scenic",
    label: "풍경 시네마틱",
    targetRangeMs: [90_000, 240_000],
    defaultTargetMs: 150_000,
    beatsHigh: 2,
    beatsMid: 4,
    beatsLow: 4,
    fallbackCutMs: 4000,
    photoBeats: 2,
    photoStacks: false,
    kenBurns: true,
    chapters: false,
    faceWeight: 0.8,
    wideBonus: 0.25,
    keepNaturalAudio: true,
    aspect: "16:9",
    yalKeywords: ["Cinematic", "Ambient"],
  },
};

// ② 분석 리포트의 추천 모드: 신호 비율에서 규칙 기반 추론.
export type RecommendationReason = "people" | "scenic" | "long" | "balanced";

export const recommendMode = (stats: {
  readonly smileyRatio: number; // fraction of samples with smile > 0.4
  readonly faceRatio: number; // fraction with a sizeable face
  readonly goldenRatio: number; // fraction captured in golden hour
  readonly usableMs: number;
}): { mode: EditMode; reason: RecommendationReason } => {
  if (stats.smileyRatio > 0.15 || stats.faceRatio > 0.35) {
    return {
      mode: "highlight",
      reason: "people",
    };
  }
  if (stats.goldenRatio > 0.25) {
    return {
      mode: "scenic",
      reason: "scenic",
    };
  }
  if (stats.usableMs > 12 * 60_000) {
    return { mode: "record", reason: "long" };
  }
  return { mode: "highlight", reason: "balanced" };
};

// 추천 길이: 사용 가능 분량의 ~15%를 모드 범위로 클램프.
export const recommendLength = (usableMs: number, mode: EditMode): number => {
  const [lo, hi] = MODE_PRESETS[mode].targetRangeMs;
  return Math.round(Math.max(lo, Math.min(hi, usableMs * 0.15)));
};

// Suno 프롬프트 자동 생성 (2순위 음악 경로).
export const sunoPrompt = (mode: EditMode, targetMs: number, tags: readonly string[]): string => {
  const mins = Math.max(1, Math.round(targetMs / 60000));
  const flavor: Record<EditMode, string> = {
    highlight: "warm acoustic travel montage, gentle build to an uplifting chorus",
    record: "light acoustic family travel diary, friendly and unhurried",
    shorts: "energetic upbeat pop, instant hook in the first two seconds",
    growth: "tender piano and strings, nostalgic and heartwarming",
    scenic: "cinematic ambient with soft strings, spacious and majestic",
  };
  const scene = tags.length > 0 ? `, scenes of ${tags.slice(0, 4).join(", ")}` : "";
  return `${flavor[mode]}${scene}, family memories, ~${mins}:00, no vocals`;
};
