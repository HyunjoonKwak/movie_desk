import { type ID, type MediaAsset, createEmptyProject } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import { parseStoredProject } from "../project-export";

// Stored projects are validated before they reach the editor. `sourceRef` is
// additive: old projects without it still load, a well-formed disk reference
// survives, and a malformed one is rejected instead of silently trusted.
const asset = (patch: Partial<MediaAsset>): MediaAsset => ({
  id: "a1" as ID,
  name: "clip.mov",
  kind: "video",
  mime: "video/quicktime",
  durationMs: 1000,
  opfsPath: "legacy-key",
  importedAt: 1,
  ...patch,
});

const stored = (media: MediaAsset) =>
  JSON.parse(JSON.stringify(createEmptyProject({ mediaLibrary: [media] })));

describe("stored project sourceRef", () => {
  it("loads assets that predate sourceRef", () => {
    const project = parseStoredProject(stored(asset({})));
    expect(project.mediaLibrary[0]?.sourceRef).toBeUndefined();
  });

  it("keeps a well-formed disk reference", () => {
    const sourceRef = {
      kind: "disk" as const,
      version: 1 as const,
      rootId: "root-1",
      rootSnapshot: { volumeUuid: "VOL", volumeRelativePath: "Movies" },
      relativePath: "2025/clip.mov",
      sizeBytes: 10,
      modifiedAtMs: 20,
    };
    const project = parseStoredProject(stored(asset({ sourceRef })));
    expect(project.mediaLibrary[0]?.sourceRef).toEqual(sourceRef);
  });

  it("rejects a disk reference that lost its root", () => {
    const broken = { kind: "disk", version: 1, relativePath: "x", sizeBytes: 1, modifiedAtMs: 1 };
    expect(() => parseStoredProject(stored(asset({ sourceRef: broken as never })))).toThrow();
  });
});
