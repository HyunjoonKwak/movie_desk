import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getThumbs: vi.fn(),
  getFilmstrips: vi.fn(),
  storedListener: undefined as
    | ((
        assetId: string,
        previews: { thumb?: string; filmstrip?: { dataUrl: string; frames: number } },
        options: { replaceMissing: boolean },
      ) => void)
    | undefined,
}));
vi.mock("@/persistence/previews", () => ({
  getThumbs: mocks.getThumbs,
  getFilmstrips: mocks.getFilmstrips,
  onPreviewsStored: (listener: typeof mocks.storedListener) => {
    mocks.storedListener = listener;
    return () => {};
  },
}));

import {
  observePreviewVisibility,
  retainFilmstrip,
  requestFilmstrips,
  requestThumbs,
  resetPreviewRequestsForTests,
  usePreviewStore,
} from "../preview-store";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFilmstrips.mockResolvedValue(new Map());
  resetPreviewRequestsForTests();
});

describe("preview store", () => {
  it("batches requests from one tick into one read", async () => {
    mocks.getThumbs.mockResolvedValue(
      new Map([
        ["a", "a-thumb"],
        ["b", "b-thumb"],
      ]),
    );
    requestThumbs(["a"]);
    requestThumbs(["b", "a"]);
    await tick();
    await vi.waitFor(() => expect(usePreviewStore.getState().thumbs.b).toBe("b-thumb"));
    expect(mocks.getThumbs).toHaveBeenCalledTimes(1);
    expect(new Set(mocks.getThumbs.mock.calls[0]?.[0])).toEqual(new Set(["a", "b"]));
  });

  it("allows a failed load to be requested again", async () => {
    mocks.getThumbs
      .mockRejectedValueOnce(new Error("blocked"))
      .mockResolvedValueOnce(new Map([["a", "ok"]]));
    requestThumbs(["a"]);
    await tick();
    await vi.waitFor(() => expect(mocks.getThumbs).toHaveBeenCalledTimes(1));
    requestThumbs(["a"]);
    await tick();
    await vi.waitFor(() => expect(usePreviewStore.getState().thumbs.a).toBe("ok"));
    expect(mocks.getThumbs).toHaveBeenCalledTimes(2);
  });

  it("remembers freshly stored previews and replaces stale memory", () => {
    usePreviewStore.getState().remember("a", {
      thumb: "old",
      filmstrip: { dataUrl: "old-strip", frames: 2 },
    });
    mocks.storedListener?.("a", { thumb: "new" }, { replaceMissing: true });
    expect(usePreviewStore.getState().thumbs.a).toBe("new");
    expect(usePreviewStore.getState().filmstrips.a).toBeUndefined();
  });

  it("keeps a stored filmstrip when migration only supplies an inline thumbnail", () => {
    usePreviewStore.getState().remember("a", {
      filmstrip: { dataUrl: "new-strip", frames: 10 },
    });
    mocks.storedListener?.("a", { thumb: "legacy-thumb" }, { replaceMissing: false });
    expect(usePreviewStore.getState().filmstrips.a?.dataUrl).toBe("new-strip");
    mocks.storedListener?.(
      "a",
      { filmstrip: { dataUrl: "migrated-strip", frames: 4 } },
      { replaceMissing: false },
    );
    expect(usePreviewStore.getState().thumbs.a).toBe("legacy-thumb");
  });

  it("caps filmstrips loaded through the batch path and can reload an evicted id", async () => {
    const strips = new Map(
      Array.from({ length: 500 }, (_, index) => [
        `id-${index}`,
        { dataUrl: `strip-${index}`, frames: 10 },
      ]),
    );
    mocks.getFilmstrips.mockResolvedValueOnce(strips).mockResolvedValueOnce(
      new Map([["id-0", { dataUrl: "reloaded", frames: 10 }]]),
    );
    requestFilmstrips([...strips.keys()]);
    await vi.waitFor(() => expect(mocks.getFilmstrips).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(Object.keys(usePreviewStore.getState().filmstrips).length).toBe(200),
    );
    expect(usePreviewStore.getState().filmstrips["id-0"]).toBeUndefined();

    requestFilmstrips(["id-0"]);
    await vi.waitFor(() => expect(mocks.getFilmstrips).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(usePreviewStore.getState().filmstrips["id-0"]?.dataUrl).toBe("reloaded"),
    );
  });

  it("keeps 300 retained filmstrips without re-requesting or eviction ping-pong", async () => {
    const strips = new Map(
      Array.from({ length: 300 }, (_, index) => [
        `retained-${index}`,
        { dataUrl: `strip-${index}`, frames: 10 },
      ]),
    );
    const releases = [...strips.keys()].map(retainFilmstrip);
    mocks.getFilmstrips.mockResolvedValue(strips);
    try {
      requestFilmstrips([...strips.keys()]);
      await vi.waitFor(() => expect(mocks.getFilmstrips).toHaveBeenCalledTimes(1));
      await vi.waitFor(() =>
        expect(Object.keys(usePreviewStore.getState().filmstrips)).toHaveLength(300),
      );
      requestFilmstrips([...strips.keys()]);
      await tick();
      expect(mocks.getFilmstrips).toHaveBeenCalledTimes(1);
    } finally {
      for (const release of releases) release();
    }
  });

  it("does not apply an old project's in-flight thumbnail load after clear", async () => {
    let resolveLoad = (_value: ReadonlyMap<string, string>) => {};
    mocks.getThumbs.mockReturnValueOnce(
      new Promise<ReadonlyMap<string, string>>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    requestThumbs(["old"]);
    await vi.waitFor(() => expect(mocks.getThumbs).toHaveBeenCalledTimes(1));
    usePreviewStore.getState().clear();
    resolveLoad(new Map([["old", "old-thumb"]]));
    await tick();
    expect(usePreviewStore.getState().thumbs).toEqual({});
  });

  it("shares one intersection observer and releases targets", () => {
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    const Constructor = vi.fn(() => ({ observe, unobserve, disconnect }));
    vi.stubGlobal("IntersectionObserver", Constructor);
    const a = {} as Element;
    const b = {} as Element;
    const stopA = observePreviewVisibility(a, () => {});
    const stopB = observePreviewVisibility(b, () => {});
    expect(Constructor).toHaveBeenCalledTimes(1);
    stopA();
    expect(unobserve).toHaveBeenCalledWith(a);
    expect(disconnect).not.toHaveBeenCalled();
    stopB();
    expect(disconnect).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
