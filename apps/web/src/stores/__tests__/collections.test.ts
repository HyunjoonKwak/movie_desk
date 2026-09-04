import type { ID } from "@movie-desk/core";
import { createEmptyProject } from "@movie-desk/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../project-store";

const collections = () => useProjectStore.getState().project.collections;

describe("collections", () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(createEmptyProject());
  });

  it("creates, fills, trims and deletes a manual collection with undo", () => {
    const store = useProjectStore.getState();
    const id = store.createCollection("  Trip   2026 ", ["a" as ID, "a" as ID]);
    expect(collections()).toEqual([{ id, name: "Trip 2026", kind: "manual", assetIds: ["a"] }]);
    store.addToCollection(id, ["a" as ID, "b" as ID]);
    expect(collections()?.[0]).toMatchObject({ assetIds: ["a", "b"] });
    store.removeFromCollection(id, ["a" as ID]);
    expect(collections()?.[0]).toMatchObject({ assetIds: ["b"] });
    store.renameCollection(id, "Trip");
    expect(collections()?.[0]?.name).toBe("Trip");
    store.renameCollection(id, "   ");
    expect(collections()?.[0]?.name).toBe("Trip");
    store.deleteCollection(id);
    expect("collections" in useProjectStore.getState().project).toBe(false);
    store.undo();
    expect(collections()?.[0]?.name).toBe("Trip");
  });

  it("saves a smart collection and leaves membership actions alone", () => {
    const store = useProjectStore.getState();
    const id = store.createSmartCollection("Best", "#trip", { minRating: 4, favorite: true });
    const before = collections();
    store.addToCollection(id, ["a" as ID]);
    expect(collections()).toBe(before);
    expect(collections()?.[0]).toEqual({
      id,
      name: "Best",
      kind: "smart",
      query: "#trip",
      filters: { minRating: 4, favorite: true },
    });
  });
});
