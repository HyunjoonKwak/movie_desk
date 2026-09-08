"use client";

import type { ID } from "@movie-desk/core";
import { activeTimelineView, timelineView } from "./active-timeline";
import { useProjectStore } from "./project-store";
import { useTimelineUiStore } from "./timeline-ui-store";
import { usePlaybackStore } from "./playback-store";
import { useSelectionStore } from "./selection-store";
import { useRangeStore } from "./range-store";

// Editor-only read projection; mutations belong to the canonical project store.
// Persistence, export and undo always retain the real project's root identity.
type EditorState = ReturnType<typeof useProjectStore.getState>;
const projectViews = new WeakMap<EditorState["project"], Map<ID | null, EditorState["project"]>>();
const projectView = (project: EditorState["project"], id: ID | null) => {
  if (id === null || id === project.rootTimelineId) return project;
  let views = projectViews.get(project);
  if (!views) {
    views = new Map();
    projectViews.set(project, views);
  }
  let view = views.get(id);
  if (!view) {
    view = timelineView(project, id);
    views.set(id, view);
  }
  return view;
};
const scopedState = (state: EditorState, id: ID | null): EditorState => {
  const project = projectView(state.project, id);
  return project === state.project ? state : { ...state, project };
};
const snapshot = () => scopedState(useProjectStore.getState(), useTimelineUiStore.getState().activeTimelineId);

function useEditorSelection<T>(selector: (state: EditorState) => T): T {
  const id = useTimelineUiStore((state) => state.activeTimelineId);
  return useProjectStore((state) => selector(scopedState(state, id)));
}

function subscribe(listener: (state: EditorState, previous: EditorState) => void): () => void;
function subscribe<T>(selector: (state: EditorState) => T, listener: (state: T, previous: T) => void, options?: { equalityFn?: (a: T, b: T) => boolean; fireImmediately?: boolean }): () => void;
function subscribe<T>(selectorOrListener: ((state: EditorState) => T) | ((state: EditorState, previous: EditorState) => void), listener?: (state: T, previous: T) => void, options?: { equalityFn?: (a: T, b: T) => boolean; fireImmediately?: boolean }): () => void {
  const selector = listener ? selectorOrListener as (state: EditorState) => T : (state: EditorState) => state as unknown as T;
  const notify = listener ?? selectorOrListener as (state: T, previous: T) => void;
  const equal = options?.equalityFn ?? Object.is;
  let previous = selector(snapshot());
  const refresh = () => {
    const next = selector(snapshot());
    if (equal(previous, next)) return;
    const before = previous;
    previous = next;
    notify(next, before);
  };
  const offProject = useProjectStore.subscribe(refresh);
  const offUi = useTimelineUiStore.subscribe((state, before) => {
    if (state.activeTimelineId !== before.activeTimelineId) refresh();
  });
  if (options?.fireImmediately) notify(previous, previous);
  return () => { offProject(); offUi(); };
}
export const useEditorStore = Object.assign(useEditorSelection, { getState: snapshot, subscribe });

export const openTimeline = (timelineId: ID): void => {
  const state = useProjectStore.getState();
  if (!state.project.timelines.some((timeline) => timeline.id === timelineId)) return;
  if (activeTimelineView(state.project).timeline.id === timelineId) return;
  usePlaybackStore.getState().setPlaying(false);
  state.endPrecisionEdit();
  state.endClipDrag();
  useSelectionStore.getState().clear();
  useRangeStore.getState().clear();
  useTimelineUiStore.getState().setActiveTimelineId(timelineId);
};

export { selectPlayhead, selectZoom, selectDuration } from "./project-store";
