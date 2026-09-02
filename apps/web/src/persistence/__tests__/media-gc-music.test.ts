import { createEmptyProject, type ID } from "@movie-desk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMediaFile: vi.fn(),
  listMediaKeys: vi.fn(),
  readMediaFile: vi.fn(),
  writeMediaFile: vi.fn(),
  listProjectsLibrary: vi.fn(),
  loadStoredProject: vi.fn(),
}));

vi.mock("../opfs", () => ({
  deleteMediaFile: mocks.deleteMediaFile,
  listMediaKeys: mocks.listMediaKeys,
  readMediaFile: mocks.readMediaFile,
  writeMediaFile: mocks.writeMediaFile,
}));

vi.mock("../project-library", () => ({
  listProjectsLibrary: mocks.listProjectsLibrary,
  loadStoredProject: mocks.loadStoredProject,
}));

import { useMusicLibraryStore } from "@/stores/music-library-store";
import { collectMediaGarbage } from "../media-gc";

describe("media GC and the global music store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProjectsLibrary.mockResolvedValue([]);
    mocks.listMediaKeys.mockResolvedValue(["music-store__keephash", "music-store__orphanhash"]);
  });

  it("keeps store files referenced by a music ref and reaps orphans", async () => {
    useMusicLibraryStore.setState({
      refs: [
        {
          id: "r1" as ID,
          title: "Kept",
          license: "free",
          moods: [],
          scenes: [],
          fileHash: "keephash",
          addedAt: 1,
        },
      ],
    });

    const removed = await collectMediaGarbage(createEmptyProject());

    expect(removed).toBe(1);
    expect(mocks.deleteMediaFile).toHaveBeenCalledWith("music-store__orphanhash");
    expect(mocks.deleteMediaFile).not.toHaveBeenCalledWith("music-store__keephash");
  });

  it("reaps everything once the refs are gone", async () => {
    useMusicLibraryStore.setState({ refs: [] });

    const removed = await collectMediaGarbage(createEmptyProject());

    expect(removed).toBe(2);
  });
});
