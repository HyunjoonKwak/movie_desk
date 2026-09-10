import { afterEach, expect, it, vi } from "vitest";
import { readSourceRoots, rootDisplayName, type SourceRoot } from "../source-roots";

// The bridge only resolves when the playback methods are present too, so a
// stub has to look like a real preload.
const bridge = (sourceRoots?: () => Promise<unknown>) => {
  vi.stubGlobal("window", {
    cutDesktop: {
      media: {
        acquirePlaybackUrl: async () => null,
        releasePlaybackUrl: async () => true,
        sourceState: async () => "online",
        ...(sourceRoots ? { sourceRoots } : {}),
      },
    },
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const root = (over: Partial<SourceRoot> = {}): SourceRoot => ({
  id: "r1",
  kind: "local",
  displayPath: "/Users/someone/Movies/Trip",
  assetCount: 12,
  totalBytes: 4096,
  state: "online",
  ...over,
});

it("returns nothing in the browser, where originals are copied instead", async () => {
  expect(await readSourceRoots()).toEqual([]);
});

it("reads the referenced locations from the desktop bridge", async () => {
  bridge(async () => [root()]);
  const roots = await readSourceRoots();
  expect(roots).toHaveLength(1);
  expect(roots[0]!.displayPath).toBe("/Users/someone/Movies/Trip");
});

it("drops a malformed response rather than rendering nonsense", async () => {
  bridge(async () => [{ id: "r1", kind: "floppy", displayPath: 7 }]);
  expect(await readSourceRoots()).toEqual([]);
});

it("names a local location by the folder the user made", () => {
  expect(rootDisplayName(root())).toBe("Trip");
});

it("names an external location by its volume so two Trips are distinguishable", () => {
  expect(
    rootDisplayName(root({ kind: "removable", displayPath: "/Volumes/T7/Movies/Trip" })),
  ).toBe("T7 / Trip");
});

it("does not repeat the volume when the folder is the volume itself", () => {
  expect(rootDisplayName(root({ kind: "removable", displayPath: "/Volumes/T7" }))).toBe("T7");
});

it("prefers a name the user gave over the folder name", () => {
  expect(rootDisplayName(root({ displayName: "2026 여행" }))).toBe("2026 여행");
});

it("treats a never-checked location as unknown rather than offline", async () => {
  bridge(async () => [{ ...root(), state: undefined }]);
  const roots = await readSourceRoots();
  expect(roots[0]!.state).toBe("unknown");
});

it("carries an offline location through so the panel can say so", async () => {
  bridge(async () => [{ ...root(), state: "offline" }]);
  const roots = await readSourceRoots();
  expect(roots[0]!.state).toBe("offline");
});
