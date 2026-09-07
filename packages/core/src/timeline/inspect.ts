import { analyzeSequenceGraph, MAX_SEQUENCE_DEPTH, wouldCreateCycle } from "./sequence-graph";
import type { Project } from "../model/project";
import type { Clip } from "../model/clip";
import type { ID } from "../utils/id";
import { clipEnd, isMediaClip } from "../model/clip";

export type IssueSeverity = "error" | "warning" | "info";

export interface ProjectIssue {
  readonly severity: IssueSeverity;
  readonly code: string;
  readonly message: string;
  readonly clipId?: string;
  readonly timelineId?: string;
}

// Static project linter; callers memoize on content changes, not playhead updates.
export const inspectProject = (project: Project): readonly ProjectIssue[] => {
  const issues: ProjectIssue[] = [];
  const assetIds = new Set(project.mediaLibrary.map((a) => a.id));
  const graph = analyzeSequenceGraph(project);
  const inspectClip = (clip: Clip, timelineId: string, preserved = false) => {
    const location = { clipId: clip.id, timelineId };
    if (clip.kind === "sequence") {
      const parent = timelineId as ID;
      const cycle = preserved
        ? graph.cyclic.has(clip.timelineId) || wouldCreateCycle(project, parent, clip.timelineId)
        : graph.cyclic.has(parent) &&
          graph.components.get(parent) === graph.components.get(clip.timelineId);
      const code = !graph.timelines.has(clip.timelineId)
        ? "missing-sequence"
        : cycle
          ? "cyclic-sequence"
          : (graph.depths.get(clip.timelineId) ?? 0) + 1 > MAX_SEQUENCE_DEPTH
            ? "depth-exceeded"
            : undefined;
      if (code) issues.push({ severity: "error", code, message: code, ...location });
    }
    if (isMediaClip(clip) && !assetIds.has(clip.assetId)) {
      issues.push({
        severity: "error",
        code: "offline-media",
        message: "Clip references missing media.",
        ...location,
      });
    }
    if (clip.duration < 1) {
      issues.push({
        severity: "warning",
        code: "zero-duration",
        message: "Clip has no duration.",
        ...location,
      });
    }
    if (isMediaClip(clip) && (clip.volume ?? 1) > 1.5) {
      issues.push({
        severity: "warning",
        code: "loud-clip",
        message: "Clip volume may clip (>150%).",
        ...location,
      });
    }
  };

  for (const timeline of graph.timelines.values()) {
    const allClips = timeline.tracks.flatMap((t) => t.clips);
    if (allClips.length === 0) {
      issues.push({
        severity: "warning",
        code: "empty-timeline",
        message: "Timeline has no clips.",
        timelineId: timeline.id,
      });
    }
    for (const clip of allClips) inspectClip(clip, timeline.id);

    // Placement gaps apply to every timeline, but never to unplaced recovery clips.
    for (const track of timeline.tracks) {
      const sorted = [...track.clips].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i]!.start - clipEnd(sorted[i - 1]!);
        if (gap > 2) {
          issues.push({
            severity: "info",
            code: "gap",
            message: `Gap of ${Math.round(gap)}ms on "${track.name}".`,
            timelineId: timeline.id,
          });
        }
      }
    }
  }
  // Recovery content receives the same checks even if its owning timeline is gone.
  for (const { timelineId, clip } of project.preservedClips ?? [])
    inspectClip(clip, timelineId, true);
  return issues;
};
