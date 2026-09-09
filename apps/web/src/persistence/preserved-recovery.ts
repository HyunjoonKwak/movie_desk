import { addClip, sequenceEditReason, type ID, type Project } from "@movie-desk/core";
import { type PreservedClip, preservedClips } from "./preserved-clips";

/**
 * Clips a merge could not place are kept in the document but are invisible:
 * absent from the timeline and from the rendered movie. These two operations
 * are the only way out of that state.
 */
const withPreserved = (project: Project, next: readonly PreservedClip[]): Project => {
  const rest = { ...project } as Project & { preservedClips?: readonly PreservedClip[] };
  if (next.length) return { ...rest, preservedClips: next };
  const { preservedClips: _drop, ...cleared } = rest;
  return cleared as Project;
};

export const findPreserved = (project: Project, clipId: ID): PreservedClip | undefined =>
  preservedClips(project).find((entry) => entry.clip.id === clipId);

/**
 * Put a preserved clip back on a real track. It goes through the same insertion
 * gate as any other clip, so restoring cannot introduce a cycle.
 */
export const restorePreservedClip = (
  project: Project,
  clipId: ID,
  trackId: ID,
): { project: Project; refusal?: string } => {
  const entry = findPreserved(project, clipId);
  if (!entry) return { project };
  const refusal = sequenceEditReason(project, [entry.clip]);
  if (refusal) return { project, refusal };
  const placed = addClip(project, trackId, entry.clip);
  if (placed === project) return { project };
  return {
    project: withPreserved(
      placed,
      preservedClips(project).filter((item) => item.clip.id !== clipId),
    ),
  };
};

/** Permanent. The caller must confirm first; nothing here can undo the loss. */
export const discardPreservedClip = (project: Project, clipId: ID): Project =>
  withPreserved(
    project,
    preservedClips(project).filter((item) => item.clip.id !== clipId),
  );
