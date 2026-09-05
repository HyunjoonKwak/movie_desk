import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getThumbs: vi.fn(),
  storedListener: undefined as
    | ((assetId: string, previews: { thumb?: string }) => void)
    | undefined,
}));
vi.mock("@/persistence/previews", () => ({
  getThumbs: mocks.getThumbs,
  getFilmstrips: vi.fn(async () => new Map()),
  onPreviewsStored: (listener: typeof mocks.storedListener) => {
    mocks.storedListener = listener;
    return () => {};
  },
}));

import { requestThumbs, resetPreviewRequestsForTests, usePreviewStore } from "../preview-store";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
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
    mocks.storedListener?.("a", { thumb: "new" });
    expect(usePreviewStore.getState().thumbs.a).toBe("new");
    expect(usePreviewStore.getState().filmstrips.a).toBeUndefined();
  });
});
