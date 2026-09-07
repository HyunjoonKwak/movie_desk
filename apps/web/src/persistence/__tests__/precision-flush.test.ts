import { useProjectStore } from "@/stores/project-store";
import { type MediaAsset, type MediaClip, createEmptyProject, newId } from "@movie-desk/core";
import { afterEach, expect, it, vi } from "vitest";
import type * as Y from "yjs";

const provider = vi.hoisted(() => ({ doc: null as Y.Doc | null, sync: () => {} }));
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    doc: Y.Doc;
    whenSynced: Promise<void>;
    constructor(_name: string, doc: Y.Doc) {
      this.doc = doc;
      provider.doc = doc;
      this.whenSynced = new Promise((resolve) => {
        provider.sync = resolve;
      });
    }
    on() {}
    destroy() {}
  },
}));
vi.mock("../checked-indexeddb", () => ({
  installCheckedWriter: (p: { doc: Y.Doc }, callbacks: { saved: () => void }) => {
    p.doc.on("update", () => queueMicrotask(callbacks.saved));
    return () => queueMicrotask(callbacks.saved);
  },
}));
import { disposeLiveDoc, getLiveDoc } from "../live-doc";

afterEach(disposeLiveDoc);

const setup = async (count = 1) => {
  disposeLiveDoc();
  const p = createEmptyProject();
  const assets: MediaAsset[] = Array.from({ length: count }, (_, i) => ({
    id: newId(),
    name: `video-${i}.mp4`,
    kind: "video",
    mime: "video/mp4",
    durationMs: 1000,
    opfsPath: `video-${i}`,
    importedAt: 0,
    width: 1920,
    height: 1080,
  }));
  const clips: MediaClip[] = assets.map((asset, i) => ({
    id: newId(),
    kind: "media",
    assetId: asset.id,
    start: i * 1000,
    duration: 1000,
    trimIn: 0,
    trimOut: 1000,
    speed: 1,
    effects: [],
    keyframes: [],
  }));
  useProjectStore.getState().loadProject({
    ...p,
    mediaLibrary: assets,
    timeline: {
      ...p.timeline,
      duration: count * 1000,
      tracks: p.timeline.tracks.map((track, i) => (i === 0 ? { ...track, clips } : track)),
    },
  });
  getLiveDoc();
  provider.sync();
  await Promise.resolve();
  let flushes = 0;
  provider.doc!.on("afterTransaction", () => {
    flushes++;
  });
  return { id: clips[0]!.id, flushes: () => flushes };
};

it.each(["commit", "cancel", "dispose"])("flushes exactly once after precision %s", async (end) => {
  const fixture = await setup();
  const store = useProjectStore.getState();
  const token = store.beginPrecisionEdit("Adjust speed");
  for (let i = 0; i < 10; i++)
    store.previewPrecisionEdit(token, () => store.previewClipSpeed(fixture.id, 1 + i / 10));
  expect(fixture.flushes()).toBe(0);
  if (end === "dispose") disposeLiveDoc();
  else store.endPrecisionEdit(token, end === "cancel");
  expect(fixture.flushes()).toBe(1);
  expect(useProjectStore.getState().precisionEditing).toBe(false);
});

it("flushes cancellation before switching projects", async () => {
  const fixture = await setup();
  const store = useProjectStore.getState();
  const token = store.beginPrecisionEdit();
  store.previewPrecisionEdit(token, () => store.previewClipSpeed(fixture.id, 2));
  store.loadProject(createEmptyProject());
  expect(fixture.flushes()).toBe(1);
  expect(useProjectStore.getState().precisionEditing).toBe(false);
});

it("measures 60 preview frames with 1000 assets and clips, including actual Yjs writes", async () => {
  const results = [];
  for (const gated of [false, true]) {
    const fixture = await setup(1000);
    const store = useProjectStore.getState();
    const token = gated ? store.beginPrecisionEdit("Adjust transform") : null;
    const timings: number[] = [];
    for (let i = 0; i < 60; i++) {
      const start = performance.now();
      if (token)
        store.previewPrecisionEdit(token, () => store.setTransform(fixture.id, { x: i / 100 }));
      else store.setTransform(fixture.id, { x: i / 100 });
      timings.push(performance.now() - start);
    }
    expect(fixture.flushes()).toBe(gated ? 0 : 60);
    const end = performance.now();
    if (token) store.endPrecisionEdit(token);
    const commitMs = performance.now() - end;
    expect(fixture.flushes()).toBe(gated ? 1 : 60);
    const sorted = timings.toSorted((a, b) => a - b);
    results.push({
      gated,
      assets: 1000,
      clips: 1000,
      frames: 60,
      p50Ms: sorted[29],
      p95Ms: sorted[56],
      commitMs,
      flushes: fixture.flushes(),
    });
  }
  process.stdout.write(`PRECISION_1000_ASSET_BENCH ${JSON.stringify(results)}\n`);
});

it("flushes master-only precision changes once and persists bus-only edits", async () => {
  const fixture = await setup();
  const store = useProjectStore.getState();
  const token = store.beginPrecisionEdit("Master gain");
  for (const gainDb of [-1, -3, -6])
    store.previewPrecisionEdit(token, () => store.previewMixer({ kind: "master", gainDb }));
  expect(fixture.flushes()).toBe(0);
  store.endPrecisionEdit(token);
  expect(fixture.flushes()).toBe(1);
  expect(provider.doc!.getMap("project-meta").get("audio")).toMatchObject({
    master: { gainDb: -6 },
  });
  store.updateMixer({ kind: "bus-add", id: "bus", name: "Bus" });
  expect(fixture.flushes()).toBe(2);
  expect(provider.doc!.getMap("project-meta").get("audio")).toMatchObject({
    buses: [{ id: "bus" }],
  });
});
