import { type MediaAsset, createEmptyProject } from "@movie-desk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMediaFile: vi.fn(),
  listMediaKeys: vi.fn(),
  listProjectsLibrary: vi.fn(),
  loadStoredProject: vi.fn(),
}));

vi.mock("../opfs", () => ({
  deleteMediaFile: mocks.deleteMediaFile,
  listMediaKeys: mocks.listMediaKeys,
}));

vi.mock("../project-library", () => ({
  listProjectsLibrary: mocks.listProjectsLibrary,
  loadStoredProject: mocks.loadStoredProject,
}));

import { collectMediaGarbage } from "../media-gc";

const asset = (opfsPath: string): MediaAsset =>
  ({
    id: `id-${opfsPath}` as MediaAsset["id"],
    name: opfsPath,
    kind: "video",
    opfsPath,
    durationMs: 1000,
    importedAt: 1,
  }) as MediaAsset;

// The startup GC pass scans every saved project before deleting anything.
// An import that completes in the meantime (the lease released, the asset
// added to the live project) used to lose its file: the pass only knew the
// project as it was when it started.
describe("media GC racing an import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMediaKeys.mockResolvedValue(["fresh-import.mp4", "true-orphan.mov"]);
  });

  it("keeps a file the live project started referencing after the pass began", async () => {
    let project = createEmptyProject();
    mocks.listProjectsLibrary.mockImplementation(async () => {
      // The import lands while the library is being scanned.
      project = { ...project, mediaLibrary: [...project.mediaLibrary, asset("fresh-import.mp4")] };
      return [];
    });

    await collectMediaGarbage(() => project);

    expect(mocks.deleteMediaFile).not.toHaveBeenCalledWith("fresh-import.mp4");
    expect(mocks.deleteMediaFile).toHaveBeenCalledWith("true-orphan.mov");
  });

  it("still accepts a plain project snapshot", async () => {
    mocks.listProjectsLibrary.mockResolvedValue([]);
    await collectMediaGarbage(createEmptyProject());
    expect(mocks.deleteMediaFile).toHaveBeenCalledTimes(2);
  });
});
