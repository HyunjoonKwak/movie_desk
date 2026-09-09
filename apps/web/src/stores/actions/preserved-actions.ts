import type { ID } from "@movie-desk/core";
import { toast } from "sonner";
import { t } from "@/i18n/use-t";
import {
  discardPreservedClip,
  restorePreservedClip,
} from "@/persistence/preserved-recovery";
import { runWith, type ProjectMutating, type SetFn } from "../store-helpers";

export interface PreservedActions {
  restorePreserved(clipId: ID, trackId: ID): void;
  /** Permanent. Callers must confirm with the user before calling this. */
  discardPreserved(clipId: ID): void;
}

export const createPreservedActions = <S extends ProjectMutating>(
  set: SetFn<S>,
): PreservedActions => ({
  restorePreserved: (clipId, trackId) =>
    runWith(set, "Restore preserved clip", (p) => {
      const result = restorePreservedClip(p, clipId, trackId);
      if (result.refusal) {
        toast.warning(t(`inspect.${result.refusal}`));
        return p;
      }
      return result.project;
    }),

  discardPreserved: (clipId) =>
    runWith(set, "Discard preserved clip", (p) => discardPreservedClip(p, clipId)),
});
