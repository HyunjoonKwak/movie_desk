import type { MediaAsset } from "@movie-desk/core";
import { describe, expect, it } from "vitest";
import {
  MEDIA_GRID_GAP,
  MEDIA_GROUP_HEADER_HEIGHT,
  buildMediaLayout,
  marqueeHitTest,
  mediaCardHeight,
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
  it("derives card and group heights from the live column width", () => {
    const groups = [{ key: "day", assets: [asset("a"), asset("b"), asset("c")] }];
    const layout = buildMediaLayout({ groups, width: 204, columns: 2, withHeaders: true });
    expect(layout.cardWidth).toBe(100);
    expect(layout.cardHeight).toBe(mediaCardHeight(100));
    expect(layout.groups[0]?.height).toBe(
      MEDIA_GROUP_HEADER_HEIGHT + layout.cardHeight * 2 + MEDIA_GRID_GAP,
    );
  });

  it("splits a large group into two measured segments", () => {
    const groups = [{ key: "day", assets: Array.from({ length: 17 }, (_, i) => asset(`${i}`)) }];
    const layout = buildMediaLayout({ groups, width: 204, columns: 2, withHeaders: true });
    expect(layout.groups[0]?.segments).toHaveLength(2);
    expect(layout.groups[0]?.segments[1]?.top).toBe(
      MEDIA_GROUP_HEADER_HEIGHT + layout.groups[0]!.segments[0]!.height + MEDIA_GRID_GAP,
    );
  });

  it("keeps a headerless single group at zero height when empty", () => {
    const groups = [{ key: "all", assets: [] }];
    const layout = buildMediaLayout({ groups, width: 204, columns: 2, withHeaders: false });
    expect(layout.height).toBe(0);
    expect(layout.groups[0]).toMatchObject({ top: 0, height: 0, headerHeight: 0, segments: [] });
    expect(marqueeHitTest(layout, groups, { x: 0, y: 0, w: 200, h: 200 })).toEqual(new Set());
  });

  it("calculates marquee hits without mounted cards", () => {
    const groups = [{ key: "all", assets: [asset("a"), asset("b"), asset("c")] }];
    const layout = buildMediaLayout({ groups, width: 204, columns: 2, withHeaders: false });
    expect(
      marqueeHitTest(layout, groups, {
        x: 0,
        y: layout.cardHeight + 1,
        w: 100,
        h: layout.cardHeight,
      }),
    ).toEqual(new Set(["c"]));
  });
});
