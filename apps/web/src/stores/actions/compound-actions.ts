import { createCompound, unpackCompound, type CompoundRefusal } from "@movie-desk/core";
import { toast } from "sonner";
import { t } from "@/i18n/use-t";
import { runWith, type ProjectMutating, type SetFn } from "../store-helpers";
import { useSelectionStore } from "../selection-store";

export interface CompoundActions {
  makeCompound(): void;
  unpackCompound(clipId: string): void;
}

// Refusals are shown rather than swallowed: a menu item that silently does
// nothing reads as a broken button.
const explain = (refusal: CompoundRefusal): void => {
  toast.warning(t(`compound.refuse.${refusal}`));
};

export const createCompoundActions = <S extends ProjectMutating>(
  set: SetFn<S>,
): CompoundActions => ({
  makeCompound: () => {
    const ids = [...useSelectionStore.getState().clipIds];
    runWith(set, "Make compound", (p) => {
      const result = createCompound(p, ids, t("compound.defaultLabel"));
      if (result.refusal) {
        explain(result.refusal);
        return p;
      }
      return result.project;
    });
    useSelectionStore.getState().clear();
  },

  unpackCompound: (clipId) => {
    runWith(set, "Unpack compound", (p) => {
      const result = unpackCompound(p, clipId as never);
      if (result.refusal) {
        explain(result.refusal);
        return p;
      }
      // Content outside the parent's trim cannot come back, so say so instead
      // of letting the timeline quietly lose clips.
      if (result.trimmedAway)
        toast.warning(t("compound.unpackTrimmed", { count: result.trimmedAway }));
      return result.project;
    });
    useSelectionStore.getState().clear();
  },
});
