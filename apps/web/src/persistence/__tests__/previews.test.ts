import { type ID, type MediaAsset, type Project, createEmptyProject } from "@movie-desk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  assetId: string;
  kind: "thumb" | "filmstrip";
  dataUrl: string;
  frames?: number;
}
const rows = new Map<string, Row>();
const libraryRows: { id: string }[] = [];
const stored = new Map<
  string,
  { status: "ok"; project: Project } | { status: "corrupt"; raw: string }
>();
const trashed = new Set<string>();

vi.mock("dexie", () => {
  class FakeTable {
    bulkPut = async (values: Row[]) => {
      for (const row of values) rows.set(row.id, row);
    };
    bulkGet = async (ids: string[]) => ids.map((id) => rows.get(id));
    bulkDelete = async (ids: string[]) => {
      for (const id of ids) rows.delete(id);
    };
    toArray = async () => [...rows.values()];
    orderBy = () => ({
      uniqueKeys: async () => [...new Set([...rows.values()].map((row) => row.assetId))],
    });
  }
  class FakeDexie {
    previews: FakeTable | undefined;
    version() {
      return {
        stores: () => {
          this.previews = new FakeTable();
        },
      };
    }
  }
  return { default: FakeDexie };
});

vi.mock("../project-library", () => ({
  listProjectsLibrary: async () => libraryRows,
  loadStoredProject: async (id: string) => stored.get(id) ?? { status: "missing" },
}));
vi.mock("../trash", () => ({ trashAssetIds: async () => new Set(trashed) }));

import { useProjectStore } from "@/stores/project-store";
import {
  collectPreviewGarbage,
  getFilmstrips,
  getThumbs,
  hasInlinePreviews,
  inlinePreviewsOf,
  leasePreview,
  putAssetPreviews,
  startInlinePreviewMigration,
  withInlinePreviews,
  withoutInlinePreviews,
} from "../previews";

const asset = (id: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id: id as ID,
  name: `${id}.png`,
  kind: "image",
  mime: "image/png",
  durationMs: 0,
  opfsPath: `${id}.png`,
  sizeBytes: 1,
  importedAt: 0,
  ...patch,
});
const project = (...assets: MediaAsset[]): Project => ({
  ...createEmptyProject(),
  mediaLibrary: assets,
});
const settle = async () => {
  await vi.waitFor(() => {
    expect(
      useProjectStore.getState().project.mediaLibrary.every((a) => !hasInlinePreviews(a)),
    ).toBe(true);
  });
};

beforeEach(() => {
  rows.clear();
  libraryRows.length = 0;
  stored.clear();
  trashed.clear();
  useProjectStore.getState().loadProject(project());
});

describe("preview persistence", () => {
  it("replaces and reads an asset's previews", async () => {
    await putAssetPreviews("a", {
      thumb: "data:image/png;base64,thumb",
      filmstrip: { dataUrl: "data:image/png;base64,strip", frames: 8 },
    });
    expect(await getThumbs(["a", "missing"])).toEqual(
      new Map([["a", "data:image/png;base64,thumb"]]),
    );
    expect(await getFilmstrips(["a"])).toEqual(
      new Map([["a", { dataUrl: "data:image/png;base64,strip", frames: 8 }]]),
    );

    await putAssetPreviews("a", { thumb: "data:image/png;base64,new" });
    expect((await getThumbs(["a"])).get("a")).toBe("data:image/png;base64,new");
    expect(await getFilmstrips(["a"])).toEqual(new Map());
  });

  it("handles inline previews and fills missing fields for JSON export", async () => {
    const legacy = asset("a", {
      thumbDataUrl: "data:image/png;base64,inline",
      filmstripDataUrl: "data:image/png;base64,strip",
      filmstripFrames: 4,
    });
    expect(hasInlinePreviews(legacy)).toBe(true);
    expect(inlinePreviewsOf(legacy).filmstrip?.frames).toBe(4);
    expect(withoutInlinePreviews(legacy)).not.toHaveProperty("thumbDataUrl");

    await putAssetPreviews("a", {
      thumb: "data:image/png;base64,stored",
      filmstrip: { dataUrl: "data:image/png;base64,stored-strip", frames: 6 },
    });
    const exported = await withInlinePreviews(
      project(asset("a", { thumbDataUrl: "data:image/png;base64,inline" })),
    );
    expect(exported.mediaLibrary[0]).toMatchObject({
      thumbDataUrl: "data:image/png;base64,inline",
      filmstripDataUrl: "data:image/png;base64,stored-strip",
      filmstripFrames: 6,
    });
  });

  it("migrates inline records without adding undo history and handles later undo-like writes", async () => {
    const first = asset("a", { thumbDataUrl: "data:image/png;base64,one" });
    useProjectStore.getState().loadProject(project(first));
    const history = useProjectStore.getState().history;
    const stop = startInlinePreviewMigration();
    await settle();
    expect(useProjectStore.getState().history).toBe(history);
    expect((await getThumbs(["a"])).get("a")).toBe("data:image/png;base64,one");

    useProjectStore
      .getState()
      .loadProject(project(asset("a", { thumbDataUrl: "data:image/png;base64,two" })));
    await settle();
    expect((await getThumbs(["a"])).get("a")).toBe("data:image/png;base64,two");
    stop();
  });

  it("keeps leased, trashed, live, saved, and corrupt-row asset ids during GC", async () => {
    for (const id of ["live", "saved", "leased", "trash", "salvaged", "stale"]) {
      await putAssetPreviews(id, { thumb: `data:image/png;base64,${id}` });
    }
    const live = project(asset("live"));
    useProjectStore.getState().loadProject(live);
    libraryRows.push({ id: "saved-project" }, { id: "corrupt-project" });
    stored.set("saved-project", { status: "ok", project: project(asset("saved")) });
    stored.set("corrupt-project", {
      status: "corrupt",
      raw: '{"mediaLibrary":[{"id":"salvaged"}], broken',
    });
    trashed.add("trash");
    const release = leasePreview("leased");

    expect(await collectPreviewGarbage(() => useProjectStore.getState().project)).toBe(1);
    expect(await getThumbs(["live", "saved", "leased", "trash", "salvaged", "stale"])).toEqual(
      new Map(
        ["live", "saved", "leased", "trash", "salvaged"].map((id) => [
          id,
          `data:image/png;base64,${id}`,
        ]),
      ),
    );
    release();
  });
});
