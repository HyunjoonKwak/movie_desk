"use client";

import { create } from "zustand";
import type { ID, Project } from "@movie-desk/core";
import type { EditMode, EditPlan, MusicAnalysis } from "./types";
import type { StoryArc } from "./story";

// Wizard state for the 6-step flow. `appliedProject` remembers the exact
// project object the last generation produced — if the store's project has
// moved past it, manual edits happened and re-runs must confirm (재조립 잠금).

interface AutoEditState {
  mode: EditMode;
  targetMs: number;
  musicAssetId: ID | null;
  pinned: readonly ID[];
  excluded: readonly ID[];
  mapTransitions: boolean;
  generating: boolean;
  plan: EditPlan | null;
  story: StoryArc | null;
  music: MusicAnalysis | null;
  appliedProject: Project | null;

  setMode: (m: EditMode) => void;
  setTargetMs: (ms: number) => void;
  setMusicAssetId: (id: ID | null) => void;
  togglePin: (id: ID) => void;
  toggleExclude: (id: ID) => void;
  // 미디어 빈의 일괄 지정 — 선택된 자산들을 한 번에 사용/제외/해제.
  markPinned: (ids: readonly ID[]) => void;
  markExcluded: (ids: readonly ID[]) => void;
  clearMarks: (ids: readonly ID[]) => void;
  setMapTransitions: (on: boolean) => void;
  setGenerating: (on: boolean) => void;
  setResult: (r: {
    plan: EditPlan;
    story: StoryArc;
    music: MusicAnalysis | null;
    appliedProject: Project;
  }) => void;
  clearResult: () => void;
}

export const useAutoEditStore = create<AutoEditState>((set) => ({
  mode: "highlight",
  targetMs: 120_000,
  musicAssetId: null,
  pinned: [],
  excluded: [],
  mapTransitions: true,
  generating: false,
  plan: null,
  story: null,
  music: null,
  appliedProject: null,

  setMode: (mode) => set({ mode }),
  setTargetMs: (targetMs) => set({ targetMs }),
  setMusicAssetId: (musicAssetId) => set({ musicAssetId }),
  togglePin: (id) =>
    set((s) => ({
      pinned: s.pinned.includes(id) ? s.pinned.filter((x) => x !== id) : [...s.pinned, id],
      excluded: s.excluded.filter((x) => x !== id),
    })),
  toggleExclude: (id) =>
    set((s) => ({
      excluded: s.excluded.includes(id) ? s.excluded.filter((x) => x !== id) : [...s.excluded, id],
      pinned: s.pinned.filter((x) => x !== id),
    })),
  markPinned: (ids) =>
    set((s) => ({
      pinned: [...new Set([...s.pinned, ...ids])],
      excluded: s.excluded.filter((x) => !ids.includes(x)),
    })),
  markExcluded: (ids) =>
    set((s) => ({
      excluded: [...new Set([...s.excluded, ...ids])],
      pinned: s.pinned.filter((x) => !ids.includes(x)),
    })),
  clearMarks: (ids) =>
    set((s) => ({
      pinned: s.pinned.filter((x) => !ids.includes(x)),
      excluded: s.excluded.filter((x) => !ids.includes(x)),
    })),
  setMapTransitions: (mapTransitions) => set({ mapTransitions }),
  setGenerating: (generating) => set({ generating }),
  setResult: ({ plan, story, music, appliedProject }) =>
    set({ plan, story, music, appliedProject, generating: false }),
  clearResult: () => set({ plan: null, music: null, appliedProject: null }),
}));
