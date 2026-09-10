import type { ID } from "@movie-desk/core";
import { beforeEach, describe, expect, it } from "vitest";
import { usePlaybackStore } from "../playback-store";
import { useSourceViewerStore } from "../source-viewer-store";

const A = "asset-a" as ID;
const B = "asset-b" as ID;

beforeEach(() => {
  useSourceViewerStore.getState().close();
  usePlaybackStore.setState({ playing: false, rate: 1 });
});

describe("source viewer store", () => {
  it("shows an asset from the start, keeps the position when re-shown, resets for another", () => {
    const s = useSourceViewerStore.getState();
    s.show(A);
    expect(useSourceViewerStore.getState()).toMatchObject({
      assetId: A,
      playheadMs: 0,
      playing: false,
    });
    s.setPlayhead(1500);
    s.show(A);
    expect(useSourceViewerStore.getState().playheadMs).toBe(1500);
    s.show(B, 300);
    expect(useSourceViewerStore.getState()).toMatchObject({ assetId: B, playheadMs: 300 });
  });

  it("never plays the timeline and the source at once", () => {
    useSourceViewerStore.getState().show(A);
    usePlaybackStore.getState().setPlaying(true);
    useSourceViewerStore.getState().setPlaying(true);
    expect(usePlaybackStore.getState().playing).toBe(false);
    expect(useSourceViewerStore.getState().playing).toBe(true);
    usePlaybackStore.getState().setPlaying(true);
    expect(useSourceViewerStore.getState().playing).toBe(false);
  });

  it("closing stops playback and forgets the asset; playing without an asset is refused", () => {
    useSourceViewerStore.getState().show(A);
    useSourceViewerStore.getState().setPlaying(true);
    useSourceViewerStore.getState().close();
    expect(useSourceViewerStore.getState()).toMatchObject({ assetId: null, playing: false });
    useSourceViewerStore.getState().setPlaying(true);
    expect(useSourceViewerStore.getState().playing).toBe(false);
  });

  it("clamps the playhead at zero and rounds it", () => {
    useSourceViewerStore.getState().show(A);
    useSourceViewerStore.getState().setPlayhead(-20);
    expect(useSourceViewerStore.getState().playheadMs).toBe(0);
    useSourceViewerStore.getState().setPlayhead(10.6);
    expect(useSourceViewerStore.getState().playheadMs).toBe(11);
  });
});
