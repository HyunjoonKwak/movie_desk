import type { ID, MediaAsset, Project } from "@movie-desk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectMediaGarbage, isMediaKeyLeased, leaseMediaKey } from "@/persistence/media-gc";
import { toMediaImportCandidate } from "../folder-import";
import type { ImportResult } from "../import";
import { type MediaImportBatchDependencies, runMediaImportBatch } from "../import-batch";

// The GC pass runs against the real lease table with its storage mocked out,
// so the batch/lease lifecycle is exercised end to end without OPFS or Dexie.
const storage = vi.hoisted(() => ({
  keys: [] as string[],
  deleted: [] as string[],
}));

vi.mock("@/persistence/trash", () => ({ trashMediaKeys: async () => {} }));
vi.mock("@/persistence/opfs", () => ({
  listMediaKeys: async () => [...storage.keys],
  deleteMediaFile: async (key: string) => {
    storage.deleted.push(key);
  },
}));
vi.mock("@/persistence/project-library", () => ({
  listProjectsLibrary: async () => [],
  loadStoredProject: async () => ({ status: "missing" }),
}));
vi.mock("@/media/audio/audio-variant", () => ({
  audioVariantKey: (asset: { opfsPath?: string }) => `${asset.opfsPath}__audio`,
}));
vi.mock("@/music/file-store", () => ({ musicStoreKeepKeys: () => new Set<string>() }));
vi.mock("@/stores/music-library-store", () => ({
  useMusicLibraryStore: { getState: () => ({ refs: [] }) },
}));

const videoFile = (name: string): File =>
  new File([new Uint8Array(4)], name, { type: "video/quicktime" });

const assetFor = (file: File): MediaAsset => ({
  id: `asset-${file.name}` as ID,
  name: file.name,
  kind: "video",
  mime: file.type,
  durationMs: 1000,
  opfsPath: file.name,
  importedAt: 1,
});

interface Harness {
  readonly events: string[];
  readonly library: MediaAsset[];
  readonly live: () => Project;
  readonly deps: MediaImportBatchDependencies;
  readonly importFile: ReturnType<typeof vi.fn<(file: File) => Promise<ImportResult>>>;
}

// `importFile` behaves like importMediaFile: it takes the OPFS lease before
// the file lands and hands the release back to the batch.
const harness = (overrides: Partial<MediaImportBatchDependencies> = {}): Harness => {
  const events: string[] = [];
  const library: MediaAsset[] = [];
  const live = () => ({ mediaLibrary: library }) as unknown as Project;
  const importFile = vi.fn<(file: File) => Promise<ImportResult>>(async (file) => {
    const release = leaseMediaKey(file.name);
    storage.keys.push(file.name);
    events.push(`import:${file.name}`);
    return {
      asset: assetFor(file),
      releaseLease: () => {
        events.push(`release:${file.name}`);
        release();
      },
    };
  });
  const deps: MediaImportBatchDependencies = {
    importFile,
    importHeicFile: async () => {
      throw new Error("not a HEIC test");
    },
    isHeicFile: (file) => /\.heic$/i.test(file.name),
    hasAsset: (assetId) => library.some((asset) => asset.id === assetId),
    addMediaAsset: (asset) => {
      events.push(`add:${asset.name}`);
      library.push(asset);
    },
    isCancelRequested: () => false,
    onFileStart: () => {},
    onFileDone: () => {},
    onFileFailed: (candidate) => {
      events.push(`failed:${candidate.file.name}`);
    },
    createPairId: () => "pair" as ID,
    ...overrides,
  };
  return { events, library, live, deps, importFile };
};

const releasesOf = (events: readonly string[], name: string): number =>
  events.filter((event) => event === `release:${name}`).length;

afterEach(() => {
  storage.keys.length = 0;
  storage.deleted.length = 0;
});

describe("runMediaImportBatch", () => {
  it("keeps the first file leased while a GC pass lands mid-batch, and releases after registering", async () => {
    const h = harness();
    const candidates = [videoFile("a.mov"), videoFile("b.mov")].map((file) =>
      toMediaImportCandidate(file),
    );
    h.importFile.mockImplementationOnce(async (file) => {
      // Startup GC runs while the batch is still importing the second file:
      // a.mov is written but not yet in the project.
      const release = leaseMediaKey(file.name);
      storage.keys.push(file.name);
      h.events.push(`import:${file.name}`);
      return { asset: assetFor(file), releaseLease: release };
    });
    h.importFile.mockImplementationOnce(async (file) => {
      const release = leaseMediaKey(file.name);
      storage.keys.push(file.name);
      expect(isMediaKeyLeased("a.mov")).toBe(true);
      await collectMediaGarbage(h.live);
      h.events.push(`import:${file.name}`);
      return {
        asset: assetFor(file),
        releaseLease: () => {
          h.events.push(`release:${file.name}`);
          release();
        },
      };
    });

    const summary = await runMediaImportBatch(candidates, h.deps);

    expect(summary).toEqual({ done: 2, failed: 0, cancelled: false });
    expect(storage.deleted).toEqual([]);
    expect(h.library.map((asset) => asset.name)).toEqual(["a.mov", "b.mov"]);
    // b.mov's release is observable; it comes only after b.mov is registered.
    expect(h.events).toEqual([
      "import:a.mov",
      "import:b.mov",
      "add:a.mov",
      "add:b.mov",
      "release:b.mov",
    ]);
    expect(isMediaKeyLeased("a.mov")).toBe(false);
    expect(isMediaKeyLeased("b.mov")).toBe(false);
  });

  it("releases each lease exactly once, only after its asset is registered", async () => {
    const h = harness();
    const candidates = [videoFile("a.mov"), videoFile("b.mov")].map((file) =>
      toMediaImportCandidate(file),
    );

    await runMediaImportBatch(candidates, h.deps);

    expect(h.events).toEqual([
      "import:a.mov",
      "import:b.mov",
      "add:a.mov",
      "release:a.mov",
      "add:b.mov",
      "release:b.mov",
    ]);
  });

  it("releases every lease still held exactly once when registration throws", async () => {
    const h = harness({
      addMediaAsset: (asset) => {
        h.events.push(`add:${asset.name}`);
        if (asset.name === "b.mov") throw new Error("store rejected the asset");
        h.library.push(asset);
      },
    });
    const candidates = [videoFile("a.mov"), videoFile("b.mov"), videoFile("c.mov")].map((file) =>
      toMediaImportCandidate(file),
    );

    await expect(runMediaImportBatch(candidates, h.deps)).rejects.toThrow("store rejected");

    expect(releasesOf(h.events, "a.mov")).toBe(1);
    expect(releasesOf(h.events, "b.mov")).toBe(1);
    expect(releasesOf(h.events, "c.mov")).toBe(1);
    expect(h.events.indexOf("release:a.mov")).toBeGreaterThan(h.events.indexOf("add:a.mov"));
    for (const name of ["a.mov", "b.mov", "c.mov"]) expect(isMediaKeyLeased(name)).toBe(false);
  });

  it("registers and releases what was imported before a cancel, exactly once", async () => {
    let started = 0;
    const h = harness({ isCancelRequested: () => started >= 1, onFileStart: () => void started++ });
    const candidates = [videoFile("a.mov"), videoFile("b.mov")].map((file) =>
      toMediaImportCandidate(file),
    );

    const summary = await runMediaImportBatch(candidates, h.deps);

    expect(summary).toEqual({ done: 1, failed: 0, cancelled: true });
    expect(h.importFile).toHaveBeenCalledTimes(1);
    expect(h.events).toEqual(["import:a.mov", "add:a.mov", "release:a.mov"]);
  });

  it("keeps going past a failed file and never touches leases it did not get", async () => {
    const h = harness();
    h.importFile.mockRejectedValueOnce(new Error("probe failed"));
    const candidates = [videoFile("bad.mov"), videoFile("good.mov")].map((file) =>
      toMediaImportCandidate(file),
    );

    const summary = await runMediaImportBatch(candidates, h.deps);

    expect(summary).toEqual({ done: 1, failed: 1, cancelled: false });
    expect(h.events).toEqual([
      "failed:bad.mov",
      "import:good.mov",
      "add:good.mov",
      "release:good.mov",
    ]);
  });

  it("skips a desktop HEIC asset the project already holds and registers new ones without a lease", async () => {
    const h = harness({ importHeicFile: async (file) => assetFor(file) });
    h.library.push(assetFor(videoFile("known.heic")));
    const candidates = [videoFile("known.heic"), videoFile("fresh.heic")].map((file) =>
      toMediaImportCandidate(file),
    );

    const summary = await runMediaImportBatch(candidates, h.deps);

    expect(summary).toEqual({ done: 2, failed: 0, cancelled: false });
    expect(h.library.map((asset) => asset.name)).toEqual(["known.heic", "fresh.heic"]);
    expect(h.events).toEqual(["add:fresh.heic"]);
    expect(h.importFile).not.toHaveBeenCalled();
  });
  it("pairs a Live Photo after both halves imported and releases each lease after its own asset", async () => {
    const h = harness();
    const still = new File([new Uint8Array(4)], "IMG_0001.jpg", { type: "image/jpeg" });
    const candidates = [still, videoFile("IMG_0001.mov"), videoFile("other.mov")].map((file) =>
      toMediaImportCandidate(file),
    );

    const summary = await runMediaImportBatch(candidates, h.deps);

    expect(summary).toEqual({ done: 3, failed: 0, cancelled: false });
    expect(h.library.map((asset) => [asset.name, asset.livePhoto])).toEqual([
      ["IMG_0001.jpg", { pairId: "pair", role: "still" }],
      ["IMG_0001.mov", { pairId: "pair", role: "motion" }],
      ["other.mov", undefined],
    ]);
    expect(h.events.slice(3)).toEqual([
      "add:IMG_0001.jpg",
      "release:IMG_0001.jpg",
      "add:IMG_0001.mov",
      "release:IMG_0001.mov",
      "add:other.mov",
      "release:other.mov",
    ]);
  });
});
