import type { Clip } from "../model/clip";
import type { Project, Timeline } from "../model/project";
import type { ID } from "../utils/id";

// Eight timeline levels (root included). Premiere/FCP-style nesting is useful,
// but is not a promise of unlimited compositing here: MAX_ASSET_TEXTURES = 24
// must also leave room for source frames, transitions and effect intermediates.
// This is our conservative budget, not a claimed limit of either editor.
export const MAX_SEQUENCE_DEPTH = 8;

// Unplaced recovery clips are not playback edges. Inspect them separately;
// putting one back on a track must pass the same insertion gate as a new clip.
export const collectSequenceRefs = (timeline: Timeline): readonly ID[] => [
  ...new Set(
    timeline.tracks.flatMap((t) =>
      t.clips.flatMap((c) => (c.kind === "sequence" ? [c.timelineId] : [])),
    ),
  ),
];

/** Iterative DFS: opens each timeline once, even for diamonds and corrupt cycles. */
export const analyzeSequenceGraph = (project: Project) => {
  const timelines = new Map(project.timelines.map((t) => [t.id, t]));
  // Mutators may be holding an edited root alias until their write boundary.
  timelines.set(project.timeline.id, project.timeline);
  const refs = new Map([...timelines].map(([id, t]) => [id, collectSequenceRefs(t)]));
  const depths = new Map<ID, number>();
  const cyclic = new Set<ID>();
  const visited = new Set<ID>();
  const order: ID[] = [];
  for (const id of timelines.keys()) {
    if (visited.has(id)) continue;
    const stack = [{ id, index: 0 }];
    visited.add(id);
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const child = refs.get(frame.id)![frame.index++];
      if (child !== undefined) {
        if (timelines.has(child) && !visited.has(child)) {
          visited.add(child);
          stack.push({ id: child, index: 0 });
        }
        continue;
      }
      order.push(frame.id);
      stack.pop();
    }
  }
  // Reverse finishing order identifies every strongly connected component,
  // including cross-edges to a subtree already finished by the first DFS.
  const reverse = new Map<ID, ID[]>([...timelines.keys()].map((id) => [id, []]));
  for (const [id, children] of refs) for (const child of children) reverse.get(child)?.push(id);
  const components = new Map<ID, ID>();
  for (const id of [...order].reverse()) {
    if (components.has(id)) continue;
    const pending = [id];
    const members: ID[] = [];
    components.set(id, id);
    while (pending.length) {
      const current = pending.pop()!;
      members.push(current);
      for (const parent of reverse.get(current) ?? []) {
        if (components.has(parent)) continue;
        components.set(parent, id);
        pending.push(parent);
      }
    }
    if (members.length > 1 || refs.get(id)?.includes(id))
      for (const member of members) cyclic.add(member);
  }
  for (const id of order) {
    depths.set(
      id,
      cyclic.has(id)
        ? MAX_SEQUENCE_DEPTH + 1
        : Math.min(
            MAX_SEQUENCE_DEPTH + 1,
            1 +
              (refs.get(id) ?? []).reduce((max, child) => Math.max(max, depths.get(child) ?? 0), 0),
          ),
    );
  }
  return { timelines, refs, depths, cyclic, components, order };
};

export const wouldCreateCycle = (
  project: Project,
  parentTimelineId: ID,
  childTimelineId: ID,
): boolean => {
  const timelines = new Map(project.timelines.map((t) => [t.id, t]));
  timelines.set(project.timeline.id, project.timeline);
  const visited = new Set<ID>();
  const pending = [childTimelineId];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === parentTimelineId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const timeline = timelines.get(id);
    if (timeline) for (const child of collectSequenceRefs(timeline)) pending.push(child);
  }
  return false;
};

/** Root counts as one level. Cycles and over-depth trees return the cap. */
export const sequenceDepth = (project: Project, timelineId: ID): number =>
  Math.min(MAX_SEQUENCE_DEPTH, analyzeSequenceGraph(project).depths.get(timelineId) ?? 0);

export type SequenceEditReason = "missing-sequence" | "cyclic-sequence" | "depth-exceeded";

/**
 * Pure preflight shared by mutators and UI. Rejected mutators return input identity.
 * Current mutators edit only the root alias, hence this default. Phase 6 non-root
 * editors MUST pass their actual target timeline ID rather than use the default.
 */
export const sequenceEditReason = (
  project: Project,
  clips: readonly Clip[],
  parentTimelineId = project.rootTimelineId,
): SequenceEditReason | undefined => {
  const sequences = clips.filter((c) => c.kind === "sequence");
  if (!sequences.length) return;
  const graph = analyzeSequenceGraph(project);
  for (const clip of sequences) {
    if (!graph.timelines.has(clip.timelineId)) return "missing-sequence";
    if (wouldCreateCycle(project, parentTimelineId, clip.timelineId)) return "cyclic-sequence";
    if (graph.cyclic.has(clip.timelineId)) return "cyclic-sequence";
  }
  const parent = graph.timelines.get(parentTimelineId);
  if (!parent) return "missing-sequence";
  const track = parent.tracks[0];
  if (!track) return;
  const proposed = {
    ...parent,
    tracks: [{ ...track, clips: [...track.clips, ...sequences] }, ...parent.tracks.slice(1)],
  };
  const next = analyzeSequenceGraph({
    ...project,
    timelines: project.timelines.map((t) => (t.id === parent.id ? proposed : t)),
    timeline: parent.id === project.rootTimelineId ? proposed : project.timeline,
  });
  for (const [id, depth] of next.depths) {
    if (depth > MAX_SEQUENCE_DEPTH && (id === parent.id || depth > (graph.depths.get(id) ?? 0)))
      return "depth-exceeded";
  }
};
