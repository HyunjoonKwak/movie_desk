import type { ID, MediaAsset, Project } from "@movie-desk/core";
import { assemble, buildCandidates, type Candidate, type ChapterBreak } from "./assembler";
import { MODE_PRESETS } from "./modes";
import { analyzeMusic } from "./music";
import { applyPlanToProject } from "./apply";
import { generateMapTransitionAsset } from "./map-transition";
import { buildStory, chapterBreaks, goldenAssetIds, type StoryArc } from "./story";
import type {
  AssetAnalysis,
  CutReason,
  EditMode,
  EditPlan,
  MusicAnalysis,
  PlanConstraints,
  PlanItem,
} from "./types";

// ④ 1차 가편집 / ⑤ 재조립 orchestration: story → candidates(+golden boost) →
// chapters → assemble → optional map-transition assets → a builder the store
// commits as ONE undoable command.

export interface GenerateOptions {
  readonly mode: EditMode;
  readonly targetMs: number;
  readonly musicAssetId?: ID;
  readonly constraints: PlanConstraints;
  readonly mapTransitions: boolean;
}

export interface GenerateResult {
  readonly plan: EditPlan;
  readonly story: StoryArc;
  readonly music?: MusicAnalysis;
  readonly mapAssets: readonly MediaAsset[];
  // Applies plan+assets to a project — hand to the store's applyGenerated.
  readonly build: (
    p: Project,
    formatting?: {
      readonly formatReasons: (reasons: readonly CutReason[]) => string;
      readonly storySummary?: string;
    },
  ) => Project;
}

const GOLDEN_BOOST = 0.15;
const MAX_MAP_TRANSITIONS = 3;

export const generate = async (
  project: Project,
  analyses: ReadonlyMap<ID, AssetAnalysis>,
  opts: GenerateOptions,
): Promise<GenerateResult> => {
  const assets = project.mediaLibrary;
  const preset = MODE_PRESETS[opts.mode];
  const story = buildStory(assets);

  // Music first — the beat grid sizes the candidate windows.
  let music: MusicAnalysis | undefined;
  if (opts.musicAssetId) {
    const m = assets.find((a) => a.id === opts.musicAssetId);
    if (m) music = (await analyzeMusic(m.id, m.opfsPath, m.durationMs)) ?? undefined;
  }
  const beatMs = music && music.bpm > 0 ? 60000 / music.bpm : preset.fallbackCutMs;
  const minWindowMs = Math.max(1200, Math.round(preset.beatsMid * beatMs));

  const { candidates, rejected } = buildCandidates(assets, analyses, opts.constraints, minWindowMs);

  // 골든아워 우선 배치 — 부스트 + 사유 태깅 (P3).
  const golden = goldenAssetIds(assets);
  const storyEvents = new Map(
    story.events.flatMap((event) => event.assetIds.map((assetId) => [assetId, event] as const)),
  );
  const boosted: Candidate[] = candidates.map((candidate) => {
    const isGolden = golden.has(candidate.assetId);
    const storyEvent = storyEvents.get(candidate.assetId);
    const storyPlace = storyEvent?.label.split("— ")[1];
    return {
      ...candidate,
      score: isGolden ? Math.min(1, candidate.score + GOLDEN_BOOST) : candidate.score,
      ...(isGolden ? { golden: true } : {}),
      ...(storyEvent ? { storyDay: storyEvent.dayIndex + 1 } : {}),
      ...(storyPlace ? { storyPlace } : {}),
    };
  });

  const chapters: readonly ChapterBreak[] = preset.chapters ? chapterBreaks(story) : [];
  const plan = assemble({
    mode: opts.mode,
    targetMs: opts.targetMs,
    candidates: boosted,
    rejected,
    ...(music ? { music } : {}),
    ...(chapters.length > 0 ? { chapters } : {}),
  });

  // 이동 감지 → 맵 트랜지션 클립 (기록형/성장형 + 옵션).
  const mapAssets: MediaAsset[] = [];
  let items: PlanItem[] = [...plan.items];
  if (opts.mapTransitions && preset.chapters) {
    for (const move of story.moves.slice(0, MAX_MAP_TRANSITIONS)) {
      const target = items.findIndex((i) => i.chapter && i.chapter === move.to.label);
      if (target < 0) continue;
      const asset = await generateMapTransitionAsset(move);
      if (!asset) continue; // WebCodecs 미지원/좌표 없음 → 조용히 생략
      mapAssets.push(asset);
      const mapItem: PlanItem = {
        assetId: asset.id,
        isPhoto: false,
        srcStartMs: 0,
        durationMs: asset.durationMs,
        reasons: [{ code: "map-transition", detail: move.label }],
      };
      items = [...items.slice(0, target), mapItem, ...items.slice(target)];
    }
  }
  const finalPlan: EditPlan = { ...plan, items };

  const assetMap = new Map<ID, MediaAsset>([
    ...assets.map((a) => [a.id, a] as const),
    ...mapAssets.map((a) => [a.id, a] as const),
  ]);
  const musicAsset = opts.musicAssetId ? assets.find((a) => a.id === opts.musicAssetId) : undefined;

  const build = (
    p: Project,
    formatting?: {
      readonly formatReasons: (reasons: readonly CutReason[]) => string;
      readonly storySummary?: string;
    },
  ): Project => {
    const withMapAssets =
      mapAssets.length > 0 ? { ...p, mediaLibrary: [...p.mediaLibrary, ...mapAssets] } : p;
    return applyPlanToProject(withMapAssets, {
      plan: finalPlan,
      assets: assetMap,
      analyses,
      ...(music && musicAsset ? { music: { ...music, opfsAssetId: musicAsset.id } } : {}),
      ...(formatting?.storySummary
        ? { summary: formatting.storySummary }
        : story.summary
          ? { summary: story.summary }
          : {}),
      ...(formatting ? { formatReasons: formatting.formatReasons } : {}),
    });
  };

  return {
    plan: finalPlan,
    story,
    ...(music ? { music } : {}),
    mapAssets,
    build,
  };
};
