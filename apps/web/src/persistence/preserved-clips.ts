import type { Clip, Project } from "@movie-desk/core";

// Durable recovery payload: placement is unknown, but timeline ownership is known.
export interface PreservedClip {
  readonly timelineId: string;
  readonly clip: Clip;
}
export const preservedClips = (project: Project): readonly PreservedClip[] =>
  (project as Project & { preservedClips?: readonly PreservedClip[] }).preservedClips ?? [];
