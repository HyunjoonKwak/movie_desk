import {
  type ID,
  createCut,
  deleteCut,
  duplicateCut,
  renameCut,
  switchCut,
} from "@movie-desk/core";
import { useSelectionStore } from "../selection-store";
import { type ProjectMutating, type SetFn, runWith } from "../store-helpers";
import { useTimelineUiStore } from "../timeline-ui-store";

export interface CutActions {
  createCut: (name?: string) => void;
  switchCut: (cutId: ID) => void;
  renameCut: (cutId: ID, name: string) => void;
  duplicateCut: (cutId: ID) => void;
  deleteCut: (cutId: ID) => void;
}

// Cuts are edited on the canonical project, so any open compound tab closes
// first; a cut change also drops the clip selection, which belonged to the
// timeline being left.
const leaveTimeline = (): void => {
  useTimelineUiStore.getState().setActiveTimelineId(null);
  useSelectionStore.getState().clear();
};

export const createCutActions = <S extends ProjectMutating>(set: SetFn<S>): CutActions => ({
  createCut: (name) => {
    leaveTimeline();
    runWith(set, "New cut", (p) => createCut(p, name).project);
  },
  // Switching is navigation, not an edit: it takes no undo slot.
  switchCut: (cutId) => {
    leaveTimeline();
    set((s) => {
      const project = switchCut(s.project, cutId);
      return project === s.project ? s : ({ project } as Partial<S>);
    });
  },
  renameCut: (cutId, name) => {
    runWith(set, "Rename cut", (p) => renameCut(p, cutId, name));
  },
  duplicateCut: (cutId) => {
    leaveTimeline();
    runWith(set, "Duplicate cut", (p) => duplicateCut(p, cutId).project);
  },
  deleteCut: (cutId) => {
    leaveTimeline();
    runWith(set, "Delete cut", (p) => deleteCut(p, cutId));
  },
});
