import { createEmptyProject } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { useProjectStore } from "../project-store";

describe("mixer actions", () => {
  it("records one undo for a gain gesture and restores the legacy optional model", () => {
    const p = createEmptyProject();
    const id = p.timeline.tracks[0]!.id;
    const store = useProjectStore.getState();
    store.loadProject(p);
    const token = store.beginPrecisionEdit("Gain");
    for (const gainDb of [-1, -3, -6])
      store.previewPrecisionEdit(token, () =>
        store.previewMixer({ kind: "track", id, patch: { gainDb } }),
      );
    expect(useProjectStore.getState().history.past).toHaveLength(0);
    store.endPrecisionEdit(token);
    expect(useProjectStore.getState().history.past).toHaveLength(1);
    expect(useProjectStore.getState().project.timeline.tracks[0]!.audio?.gainDb).toBe(-6);
    store.undo();
    expect(useProjectStore.getState().project.timeline.tracks[0]!.audio).toBeUndefined();
  });
  it("cleans track bus references on deletion and undo restores them", () => {
    const p = createEmptyProject();
    const id = p.timeline.tracks[0]!.id;
    const store = useProjectStore.getState();
    store.loadProject(p);
    store.updateMixer({ kind: "bus-add", id: "music", name: "Music" });
    store.updateMixer({ kind: "track", id, patch: { busId: "music", gainDb: -6 } });
    store.updateMixer({ kind: "bus-delete", id: "music" });
    expect(useProjectStore.getState().project.timeline.tracks[0]!.audio).toEqual({ gainDb: -6 });
    store.undo();
    expect(useProjectStore.getState().project.timeline.tracks[0]!.audio?.busId).toBe("music");
    expect(useProjectStore.getState().project.audio?.buses).toHaveLength(1);
  });
});
