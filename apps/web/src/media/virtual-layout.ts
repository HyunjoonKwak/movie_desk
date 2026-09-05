import type { ID, MediaAsset } from "@movie-desk/core";

export const MEDIA_GRID_GAP = 4;
// Header box: 4px top padding + a 16px button box (12px line box + py-0.5 4px)
// + 1px rounding allowance.
export const MEDIA_GROUP_HEADER_HEIGHT = 21;
export const MEDIA_SEGMENT_ROWS = 8;
// MediaCard: li p-1 (8px) + button borders (2px) reduce the 16:9 content
// width by 10px. Vertical chrome is those 10px plus the measured 28px
// metadata row (16px line box + 12px padding) in Chrome 152.
export const MEDIA_CARD_INLINE_CHROME = 10;
// Sum of the li's vertical p-1, used to convert its border-box model height
// to the content-box value required by contain-intrinsic-size.
export const MEDIA_CARD_PADDING = 8;
export const MEDIA_CARD_BLOCK_CHROME = MEDIA_CARD_PADDING + 2 + 28;

export interface VirtualMediaGroup {
  readonly key: string;
  readonly assets: readonly MediaAsset[];
}

export interface MediaSegmentLayout {
  readonly key: string;
  readonly groupKey: string;
  readonly start: number;
  readonly end: number;
  readonly top: number;
  readonly height: number;
}

export interface MediaGroupLayout {
  readonly key: string;
  readonly top: number;
  readonly height: number;
  readonly headerHeight: number;
  readonly segments: readonly MediaSegmentLayout[];
}

export interface MediaLayout {
  readonly height: number;
  readonly width: number;
  readonly columns: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly groups: readonly MediaGroupLayout[];
}

export function mediaColumns(thumbSize: number): number {
  return thumbSize === 0 ? 3 : thumbSize === 2 ? 1 : 2;
}

export function mediaCardHeight(cardWidth: number): number {
  if (cardWidth <= 0) return 0;
  return (
    Math.round(Math.max(0, cardWidth - MEDIA_CARD_INLINE_CHROME) * (9 / 16)) +
    MEDIA_CARD_BLOCK_CHROME
  );
}

export function buildMediaLayout({
  groups,
  width,
  columns,
  withHeaders,
}: {
  groups: readonly VirtualMediaGroup[];
  width: number;
  columns: number;
  withHeaders: boolean;
}): MediaLayout {
  const safeWidth = Math.max(0, width);
  const cardWidth = Math.max(0, (safeWidth - MEDIA_GRID_GAP * (columns - 1)) / columns);
  const cardHeight = mediaCardHeight(cardWidth);
  const layouts: MediaGroupLayout[] = [];
  let top = 0;

  for (const group of groups) {
    const groupTop = top;
    const headerHeight = withHeaders ? MEDIA_GROUP_HEADER_HEIGHT : 0;
    top += headerHeight;
    const segments: MediaSegmentLayout[] = [];
    const cardsPerSegment = columns * MEDIA_SEGMENT_ROWS;
    for (let start = 0; start < group.assets.length; start += cardsPerSegment) {
      const end = Math.min(group.assets.length, start + cardsPerSegment);
      const rows = Math.ceil((end - start) / columns);
      const height = rows * cardHeight + Math.max(0, rows - 1) * MEDIA_GRID_GAP;
      segments.push({ key: `${group.key}:${start}`, groupKey: group.key, start, end, top, height });
      top += height + MEDIA_GRID_GAP;
    }
    if (group.assets.length > 0) top -= MEDIA_GRID_GAP;
    const height = Math.max(0, top - groupTop);
    layouts.push({ key: group.key, top: groupTop, height, headerHeight, segments });
    top += MEDIA_GRID_GAP;
  }

  return {
    height: Math.max(0, top - (layouts.length > 0 ? MEDIA_GRID_GAP : 0)),
    width: safeWidth,
    columns,
    cardWidth,
    cardHeight,
    groups: layouts,
  };
}

export function marqueeHitTest(
  layout: MediaLayout,
  groups: readonly VirtualMediaGroup[],
  rect: { x: number; y: number; w: number; h: number },
): Set<ID> {
  const hits = new Set<ID>();
  if (layout.width <= 0 || layout.cardHeight <= 0) return hits;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex]!;
    const groupLayout = layout.groups[groupIndex];
    if (!groupLayout) continue;
    for (let index = 0; index < group.assets.length; index += 1) {
      const row = Math.floor(index / layout.columns);
      const column = index % layout.columns;
      const x = column * (layout.cardWidth + MEDIA_GRID_GAP);
      const y =
        groupLayout.top + groupLayout.headerHeight + row * (layout.cardHeight + MEDIA_GRID_GAP);
      if (
        x < rect.x + rect.w &&
        x + layout.cardWidth > rect.x &&
        y < rect.y + rect.h &&
        y + layout.cardHeight > rect.y
      )
        hits.add(group.assets[index]!.id);
    }
  }
  return hits;
}
