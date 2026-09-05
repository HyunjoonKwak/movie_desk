import { describe, expect, it } from "vitest";
import type { MediaAsset } from "@movie-desk/core";
import {
  MEDIA_GRID_GAP,
  buildMediaLayout,
  marqueeHitTest,
  visibleSegmentKeys,
} from "../virtual-layout";

const asset = (id: string): MediaAsset =>
  ({
    id,
    name: id,
    kind: "image",
    mime: "image/png",
    durationMs: 0,
    importedAt: 0,
    opfsPath: id,
  }) as MediaAsset;

describe("virtual media layout", () => {
  it("calculates group heights and card rows", () => {
    const layout = buildMediaLayout({
      groups: [{ key: "day", assets: [asset("a"), asset("b"), asset("c")] }],
      width: 204,
      columns: 2,
      cardHeight: 100,
      withHeaders: true,
    });
    expect(layout.groups[0]?.height).toBe(21 + 100 * 2 + MEDIA_GRID_GAP);
    expect(layout.cards.map(({ x, y }) => [x, y])).toEqual([
      [0, 21],
      [104, 21],
      [0, 125],
    ]);
  });

  it("returns visible segments with group overscan", () => {
    const layout = buildMediaLayout({
      groups: [
        { key: "a", assets: [asset("a")] },
        { key: "b", assets: [asset("b")] },
        { key: "c", assets: [asset("c")] },
      ],
      width: 100,
      columns: 1,
      cardHeight: 100,
      withHeaders: true,
    });
    expect([...visibleSegmentKeys(layout.groups, 125, 250, 1)]).toEqual(["a:0", "b:0", "c:0"]);
  });

  it("hits cards that are not mounted", () => {
    const layout = buildMediaLayout({
      groups: [{ key: "all", assets: [asset("a"), asset("b"), asset("c")] }],
      width: 204,
      columns: 2,
      cardHeight: 100,
      withHeaders: false,
    });
    expect([...marqueeHitTest(layout.cards, { x: 0, y: 102, w: 100, h: 100 })]).toEqual(["c"]);
  });
});
