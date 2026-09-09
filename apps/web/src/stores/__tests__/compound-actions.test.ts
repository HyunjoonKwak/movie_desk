import { createEmptyProject, newId, type ID, type MediaClip, type SequenceClip } from "@movie-desk/core";
import { toast } from "sonner";
import { afterEach, expect, it, vi } from "vitest";
import { useProjectStore } from "../project-store";
import { useSelectionStore } from "../selection-store";
import { useTimelineUiStore } from "../timeline-ui-store";

afterEach(() => vi.restoreAllMocks());

const media = (start: number, duration: number): MediaClip => ({
  id: newId(),
  kind: "media",
  assetId: newId(),
  start,
  duration,
  trimIn: 0,
  trimOut: duration,
  speed: 1,
  effects: [],
  keyframes: [],
});

const load = (clips: readonly MediaClip[]) => {
  const base = createEmptyProject();
  const trackId = base.timeline.tracks[0]!.id;
  const project = {
    ...base,
    timeline: {
      ...base.timeline,
      tracks: base.timeline.tracks.map((t, i) => (i ? t : { ...t, clips: [...clips] })),
    },
  };
  useProjectStore.getState().loadProject(project);
  return { trackId };
};

const clips = () =>
  useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips);

it("makes a compound and undoes it in one step", () => {
  const a = media(0, 1000);
  const b = media(2000, 1000);
  load([a, b]);
  const before = useProjectStore.getState().project;

  useSelectionStore.getState().selectMany([a.id, b.id]);
  useProjectStore.getState().makeCompound();

  const placed = clips();
  expect(placed).toHaveLength(1);
  expect(placed[0]!.kind).toBe("sequence");
  expect(useProjectStore.getState().project.timelines).toHaveLength(2);

  useProjectStore.getState().undo();
  expect(useProjectStore.getState().project).toBe(before);
});

it("unpacks back to the original clips in one undo step", () => {
  const a = media(0, 1000);
  const b = media(2000, 1000);
  load([a, b]);
  useSelectionStore.getState().selectMany([a.id, b.id]);
  useProjectStore.getState().makeCompound();
  const packed = useProjectStore.getState().project;
  const sequence = clips()[0] as SequenceClip;

  useProjectStore.getState().unpackCompound(sequence.id);
  expect(clips().map((c) => c.start).sort((x, y) => x - y)).toEqual([0, 2000]);

  useProjectStore.getState().undo();
  expect(useProjectStore.getState().project).toBe(packed);
});

it("explains an empty selection instead of doing nothing", () => {
  const a = media(0, 1000);
  load([a]);
  useSelectionStore.getState().clear();
  const warning = vi.spyOn(toast, "warning").mockReturnValue("x");
  const before = useProjectStore.getState().project;

  useProjectStore.getState().makeCompound();

  expect(warning).toHaveBeenCalledOnce();
  expect(useProjectStore.getState().project).toBe(before);
  // A refused edit must not consume an undo slot.
  expect(useProjectStore.getState().history.past).toHaveLength(0);
});

it("explains a non-compound clip rather than silently ignoring the menu", () => {
  const a = media(0, 1000);
  load([a]);
  const warning = vi.spyOn(toast, "warning").mockReturnValue("x");
  useProjectStore.getState().unpackCompound(a.id);
  expect(warning).toHaveBeenCalledOnce();
});

it("keeps the tab selection out of history", () => {
  const a = media(0, 1000);
  load([a]);
  useSelectionStore.getState().selectMany([a.id]);
  useProjectStore.getState().makeCompound();
  const child = useProjectStore
    .getState()
    .project.timelines.find((tl) => tl.id !== useProjectStore.getState().project.rootTimelineId)!;

  const depth = useProjectStore.getState().history.past.length;
  useTimelineUiStore.getState().setActiveTimelineId(child.id as ID);
  expect(useProjectStore.getState().history.past).toHaveLength(depth);
});
