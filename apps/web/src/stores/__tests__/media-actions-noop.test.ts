import type { ID, MediaAsset } from "@movie-desk/core";
import { createEmptyProject } from "@movie-desk/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../project-store";

const media: MediaAsset = {
  id: "asset" as ID,
  name: "asset.mp4",
  kind: "video",
  mime: "video/mp4",
  durationMs: 1_000,
  sizeBytes: 100,
  opfsPath: "media/asset.mp4",
  proxyPath: "proxy/asset.mp4",
  proxyWidth: 640,
  proxyHeight: 360,
  importedAt: 0,
};

const resetProject = () =>
  useProjectStore.getState().loadProject({ ...createEmptyProject(), mediaLibrary: [media] });

describe("media action no-ops", () => {
  beforeEach(resetProject);

  const expectRedoPreserved = (action: () => void) => {
    useProjectStore.getState().setAssetsFavorite([media.id], true);
    useProjectStore.getState().undo();
    const before = useProjectStore.getState();
    action();
    const after = useProjectStore.getState();
    expect(after.project).toBe(before.project);
    expect(after.history.past).toHaveLength(before.history.past.length);
    expect(after.history.future).toBe(before.history.future);
  };

  it("preserves history when attaching an unchanged proxy or targeting missing media", () => {
    expectRedoPreserved(() =>
      useProjectStore.getState().setAssetProxy(media.id, {
        proxyPath: media.proxyPath!,
        proxyWidth: media.proxyWidth!,
        proxyHeight: media.proxyHeight!,
      }),
    );
    resetProject();
    expectRedoPreserved(() =>
      useProjectStore.getState().setAssetProxy("missing" as ID, {
        proxyPath: "proxy/missing.mp4",
        proxyWidth: 640,
        proxyHeight: 360,
      }),
    );
  });

  it("preserves history for missing, already-cleared, and too-short range edits", () => {
    expectRedoPreserved(() =>
      useProjectStore.getState().setAssetUseRange("missing" as ID, undefined),
    );
    resetProject();
    expectRedoPreserved(() => useProjectStore.getState().setAssetUseRange(media.id, undefined));
    resetProject();
    expectRedoPreserved(() =>
      useProjectStore.getState().setAssetUseRange(media.id, { inMs: 100, outMs: 200 }),
    );
  });

  it("preserves history for missing relinks and missing removals", () => {
    expectRedoPreserved(() =>
      useProjectStore.getState().relinkMediaAsset("missing" as ID, {
        sizeBytes: 10,
        mime: "video/mp4",
        dropProxy: false,
      }),
    );
    resetProject();
    expectRedoPreserved(() => useProjectStore.getState().removeMediaAsset("missing" as ID));
  });
});
