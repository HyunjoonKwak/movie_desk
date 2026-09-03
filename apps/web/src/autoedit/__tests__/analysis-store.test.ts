import type { ID, MediaAsset } from "@movie-desk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAnalysisAssetLookup, useAnalysisStore } from "../analysis-store";
import { analyzeAsset } from "../analyzer";
import type { AssetAnalysis } from "../types";

vi.mock("../analyzer", () => ({ analyzeAsset: vi.fn() }));

const asset = (id: string): MediaAsset =>
  ({
    id: id as ID,
    name: `${id}.mp4`,
    kind: "video",
    mime: "video/mp4",
    durationMs: 5_000,
    opfsPath: `${id}__source`,
    importedAt: 1,
  }) as MediaAsset;

const resultFor = (item: MediaAsset): AssetAnalysis => ({
  assetId: item.id,
  kind: "video",
  durationMs: item.durationMs,
  samples: [],
  shakeTier: "stable",
  junk: [],
  interest: [],
  quality: 1,
});

describe("analysis store cancellation", () => {
  beforeEach(() => {
    vi.mocked(analyzeAsset).mockReset();
    useAnalysisStore.getState().reset();
  });

  it("keeps completed results and resumes only unfinished assets", async () => {
    const first = asset("first");
    const second = asset("second");
    const assets = [first, second];
    setAnalysisAssetLookup((id) => assets.find((item) => item.id === id));

    let resolveSecond: ((result: AssetAnalysis | null) => void) | undefined;
    vi.mocked(analyzeAsset).mockImplementation((item, _onProgress, signal) => {
      if (item.id === first.id) return Promise.resolve(resultFor(item));
      return new Promise((resolve) => {
        resolveSecond = resolve;
        signal?.addEventListener("abort", () => resolve(null), { once: true });
      });
    });

    useAnalysisStore.getState().enqueue(assets);
    await vi.waitFor(() => expect(analyzeAsset).toHaveBeenCalledTimes(2));
    expect(useAnalysisStore.getState().entries[first.id]?.status).toBe("done");

    const firstSignal = vi.mocked(analyzeAsset).mock.calls[1]?.[2];
    useAnalysisStore.getState().cancel();

    expect(firstSignal?.aborted).toBe(true);
    expect(useAnalysisStore.getState()).toMatchObject({ running: false, queue: [] });
    expect(useAnalysisStore.getState().entries[first.id]?.status).toBe("done");
    expect(useAnalysisStore.getState().entries[second.id]).toMatchObject({
      status: "pending",
      progress: 0,
    });

    useAnalysisStore.getState().resume(assets);
    await vi.waitFor(() => expect(analyzeAsset).toHaveBeenCalledTimes(3));
    expect(vi.mocked(analyzeAsset).mock.calls[2]?.[0].id).toBe(second.id);

    resolveSecond?.(resultFor(second));
    await vi.waitFor(() =>
      expect(useAnalysisStore.getState().entries[second.id]?.status).toBe("done"),
    );
    expect(useAnalysisStore.getState().running).toBe(false);
  });
});
