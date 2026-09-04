// Shared helpers for the project store's action slices. Each slice receives
// the same `SetFn`/`GetFn` pair so it can compose against the single source
// of truth without circular imports.

import type { Project } from "@movie-desk/core";
import { runCommand } from "@movie-desk/core";
import type { CommandHistory } from "@movie-desk/core";

export interface ProjectMutating {
  readonly project: Project;
  readonly history: CommandHistory;
}

export type SetFn<S extends ProjectMutating> = (fn: (s: S) => Partial<S>) => void;
// History-aware wrapper: every mutating action goes through this so undo /
// redo work uniformly. Use a plain `set` instead when an edit is transient
// (slider drags, playhead/zoom) and shouldn't appear in the undo stack.
export const runWith = <S extends ProjectMutating>(
  set: SetFn<S>,
  label: string,
  fn: (p: Project) => Project,
): void => {
  set((s) => {
    const r = runCommand(s.project, s.history, { label, apply: fn });
    // A no-op edit (the action found nothing to change) must not consume an
    // undo slot or discard the redo stack.
    if (r.project === s.project) return s;
    return { project: r.project, history: r.history } as Partial<S>;
  });
};
