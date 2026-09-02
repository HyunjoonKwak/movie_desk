import { createEmptyProject } from "@movie-desk/core";
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

describe("media GC with damaged project storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProjectsLibrary.mockResolvedValue([{ id: "damaged" }]);
    // A corrupt row still yields its raw JSON so GC can salvage the OPFS
    // references a recoverable project uses.
    mocks.loadStoredProject.mockResolvedValue({
      status: "corrupt",
      raw: JSON.stringify({ mediaLibrary: [{ opfsPath: "possibly-recoverable.mov" }] }),
    });
    mocks.listMediaKeys.mockResolvedValue(["possibly-recoverable.mov", "true-orphan.mov"]);
  });

  it("preserves media a corrupt project references but still reclaims real orphans", async () => {
    await collectMediaGarbage(createEmptyProject());
    // Salvaged from the corrupt row's raw JSON — must NOT be deleted.
    expect(mocks.deleteMediaFile).not.toHaveBeenCalledWith("possibly-recoverable.mov");
    // A genuine orphan is still reclaimed: one corrupt row no longer disables
    // GC entirely (the bug this fix targets).
    expect(mocks.deleteMediaFile).toHaveBeenCalledWith("true-orphan.mov");
  });
});
