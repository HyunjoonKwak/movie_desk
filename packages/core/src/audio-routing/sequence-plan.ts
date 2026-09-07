import type { MediaClip, SequenceClip } from "../model/clip";
import type { Project, Timeline } from "../model/project";
import { analyzeSequenceGraph, MAX_SEQUENCE_DEPTH } from "../timeline/sequence-graph";
import { sourceOffsetForRamp } from "../timeline/speed";
import { resolveTrackRoute, type TrackRoute } from "./routing";

export interface AudioPlanClip {
  readonly clip: MediaClip | SequenceClip;
  readonly trackId: string;
  readonly route: TrackRoute;
  readonly bus: "voice" | "music";
  readonly child?: AudioSequencePlan;
}
export interface AudioSequencePlan {
  readonly timeline: Timeline;
  readonly clips: readonly AudioPlanClip[];
}

export const sequenceAudioTime = (clip: SequenceClip, parentMs: number): number =>
  clip.trimIn + sourceOffsetForRamp(clip, parentMs - clip.start);

// Preserve instance boundaries: local solo, ordered pan matrices and envelopes
// cannot be flattened into leaf routes. Invalid edges match picture's silence.
export const buildAudioSequencePlan = (
  project: Project,
  rootSourceOnly = false,
): AudioSequencePlan => {
  const graph = analyzeSequenceGraph(project);
  const visit = (timeline: Timeline, ancestry: readonly string[]): AudioSequencePlan => ({
    timeline,
    clips: timeline.tracks.flatMap((track) => {
      const resolved = resolveTrackRoute(
        project,
        track,
        timeline,
        ancestry.length === 1 && !rootSourceOnly,
      );
      const route =
        rootSourceOnly && ancestry.length === 1
          ? { ...resolved, trackGain: resolved.trackGain === 0 ? 0 : 1, pan: 0 }
          : resolved;
      if (route.trackGain === 0 || route.busGain === 0) return [];
      return track.clips.flatMap((clip): AudioPlanClip[] => {
        if (clip.disabled || (clip.kind !== "media" && clip.kind !== "sequence")) return [];
        const entry = {
          clip,
          trackId: track.id,
          route,
          bus: track.kind === "audio" ? ("music" as const) : ("voice" as const),
        };
        if (clip.kind === "media") return [entry];
        const child = graph.timelines.get(clip.timelineId);
        if (
          !child ||
          graph.cyclic.has(child.id) ||
          ancestry.includes(child.id) ||
          ancestry.length + (graph.depths.get(child.id) ?? 1) > MAX_SEQUENCE_DEPTH
        )
          return [];
        return [{ ...entry, child: visit(child, [...ancestry, child.id]) }];
      });
    }),
  });
  return visit(project.timeline, [project.timeline.id]);
};
