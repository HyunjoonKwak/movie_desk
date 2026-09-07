import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createEmptyProject, newId, replaceTimeline, type SequenceClip } from "@movie-desk/core";
import { useProjectStore } from "../project-store";

afterEach(() => vi.restoreAllMocks());

it.each(["add", "move", "duplicate", "paste"])(
  "explains rejected %s and preserves project/history identity",
  (action) => {
    const base = createEmptyProject();
    const clip: SequenceClip = {
      kind: "sequence",
      id: newId(),
      timelineId: base.rootTimelineId,
      start: 0,
      duration: 1000,
      trimIn: 0,
      trimOut: 1000,
      speed: 1,
      effects: [],
      keyframes: [],
    };
    const corrupt = replaceTimeline(base, {
      ...base.timeline,
      tracks: base.timeline.tracks.map((t, i) => (i ? t : { ...t, clips: [clip] })),
    });
    useProjectStore.getState().loadProject(corrupt);
    const before = useProjectStore.getState();
    const warning = vi.spyOn(toast, "warning").mockReturnValue("sequence-test");
    if (action === "add") before.addClipToTrack(corrupt.timeline.tracks[0]!.id, clip);
    if (action === "move") before.moveClipToOtherTrack(clip.id, corrupt.timeline.tracks[1]!.id);
    if (action === "duplicate") before.duplicateClipById(clip.id);
    if (action === "paste")
      before.pasteClipsAt([{ trackId: corrupt.timeline.tracks[0]!.id, clip }], 1000);
    const after = useProjectStore.getState();
    expect(after.project).toBe(before.project);
    expect(after.history).toBe(before.history);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]![0]).toEqual(expect.any(String));
  },
);
