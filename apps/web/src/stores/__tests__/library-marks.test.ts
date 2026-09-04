import type { ID, MediaAsset } from "@movie-desk/core";
import { createEmptyProject } from "@movie-desk/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../project-store";

const asset = (id: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id: id as ID,
  name: `${id}.mp4`,
  kind: "video",
  mime: "video/mp4",
  durationMs: 1000,
  opfsPath: `media/${id}.mp4`,
  importedAt: 0,
  ...patch,
});

const library = () => useProjectStore.getState().project.mediaLibrary;
const byId = (id: string) => library().find((a) => a.id === id)!;

describe("library marks", () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject({
      ...createEmptyProject(),
      mediaLibrary: [asset("a"), asset("b", { tags: ["Sea"], rating: 2 }), asset("c")],
    });
  });

  it("rates a selection in one undo step and clears by dropping the field", () => {
    const store = useProjectStore.getState();
    store.setAssetsRating(["a" as ID, "b" as ID], 5);
    expect(byId("a").rating).toBe(5);
    expect(byId("b").rating).toBe(5);
    expect(byId("c").rating).toBeUndefined();
    store.undo();
    expect(byId("a").rating).toBeUndefined();
    expect(byId("b").rating).toBe(2);
    store.setAssetsRating(["b" as ID], null);
    expect("rating" in byId("b")).toBe(false);
  });

  it("keeps the record identity and the undo history when nothing changes", () => {
    const before = byId("b");
    const history = useProjectStore.getState().history;
    useProjectStore.getState().setAssetsRating(["b" as ID], 2);
    useProjectStore.getState().addAssetsTags(["b" as ID], ["sea"]);
    useProjectStore.getState().setAssetsFavorite(["b" as ID], false);
    expect(byId("b")).toBe(before);
    expect(library()).toBe(useProjectStore.getState().project.mediaLibrary);
    expect(useProjectStore.getState().history).toBe(history);
  });

  it("adds several tags as one undo step, removes case-insensitively, drops an empty list", () => {
    const store = useProjectStore.getState();
    const depth = store.history.past.length;
    store.addAssetsTags(["a" as ID, "b" as ID], ["Trip", "sea"]);
    expect(byId("a").tags).toEqual(["Trip", "sea"]);
    expect(byId("b").tags).toEqual(["Sea", "Trip"]);
    expect(useProjectStore.getState().history.past).toHaveLength(depth + 1);
    store.undo();
    expect("tags" in byId("a")).toBe(false);
    store.redo();
    expect(byId("a").tags).toEqual(["Trip", "sea"]);
    store.removeAssetsTag(["a" as ID], "SEA");
    store.removeAssetsTag(["a" as ID, "b" as ID], "TRIP");
    expect("tags" in byId("a")).toBe(false);
    expect(byId("b").tags).toEqual(["Sea"]);
  });

  it("toggles favourite", () => {
    const store = useProjectStore.getState();
    store.setAssetsFavorite(["c" as ID], true);
    expect(byId("c").favorite).toBe(true);
    store.setAssetsFavorite(["c" as ID], false);
    expect("favorite" in byId("c")).toBe(false);
  });
});
