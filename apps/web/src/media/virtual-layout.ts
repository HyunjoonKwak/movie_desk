import type { ID, MediaAsset } from "@movie-desk/core";

export const MEDIA_GRID_GAP = 4;
export const MEDIA_GROUP_HEADER_HEIGHT = 21;
export const MEDIA_SEGMENT_ROWS = 8;

export interface VirtualMediaGroup {
  readonly key: string;
  readonly assets: readonly MediaAsset[];
}

export interface MediaCardRect {
  readonly id: ID;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
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
  readonly groups: readonly MediaGroupLayout[];
  readonly cards: readonly MediaCardRect[];
  readonly cardTops: ReadonlyMap<ID, number>;
}

export function mediaColumns(thumbSize: number): number {
  return thumbSize === 0 ? 3 : thumbSize === 2 ? 1 : 2;
}

export function buildMediaLayout({
  groups,
  width,
  columns,
  cardHeight,
  withHeaders,
}: {
  groups: readonly VirtualMediaGroup[];
  width: number;
  columns: number;
  cardHeight: number;
  withHeaders: boolean;
}): MediaLayout {
  const safeWidth = Math.max(0, width);
  const cardWidth = Math.max(0, (safeWidth - MEDIA_GRID_GAP * (columns - 1)) / columns);
  const cards: MediaCardRect[] = [];
  const cardTops = new Map<ID, number>();
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
      const segmentTop = top;
      segments.push({
        key: `${group.key}:${start}`,
        groupKey: group.key,
        start,
        end,
        top: segmentTop,
        height,
      });
      for (let index = start; index < end; index += 1) {
        const local = index - start;
        const row = Math.floor(local / columns);
        const column = local % columns;
        const asset = group.assets[index];
        if (!asset) continue;
        const rect = {
          id: asset.id,
          x: column * (cardWidth + MEDIA_GRID_GAP),
          y: segmentTop + row * (cardHeight + MEDIA_GRID_GAP),
          width: cardWidth,
          height: cardHeight,
        };
        cards.push(rect);
        cardTops.set(asset.id, rect.y);
      }
      top += height + MEDIA_GRID_GAP;
    }
    const height = Math.max(0, top - groupTop - MEDIA_GRID_GAP);
    if (group.assets.length > 0) top -= MEDIA_GRID_GAP;
    layouts.push({ key: group.key, top: groupTop, height, headerHeight, segments });
    top += MEDIA_GRID_GAP;
  }

  return {
    height: Math.max(0, top - (layouts.length > 0 ? MEDIA_GRID_GAP : 0)),
    groups: layouts,
    cards,
    cardTops,
  };
}

export function marqueeHitTest(
  cards: readonly MediaCardRect[],
  rect: { x: number; y: number; w: number; h: number },
): Set<ID> {
  const hits = new Set<ID>();
  for (const card of cards) {
    if (
      card.x < rect.x + rect.w &&
      card.x + card.width > rect.x &&
      card.y < rect.y + rect.h &&
      card.y + card.height > rect.y
    ) {
      hits.add(card.id);
    }
  }
  return hits;
}

export function visibleSegmentKeys(
  groups: readonly MediaGroupLayout[],
  top: number,
  bottom: number,
  overscanGroups = 1,
): Set<string> {
  const visibleGroups = groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.top < bottom && group.top + group.height > top);
  if (visibleGroups.length === 0) return new Set();
  const first = Math.max(0, visibleGroups[0]!.index - overscanGroups);
  const last = Math.min(groups.length - 1, visibleGroups.at(-1)!.index + overscanGroups);
  const keys = new Set<string>();
  for (let index = first; index <= last; index += 1) {
    for (const segment of groups[index]!.segments) keys.add(segment.key);
  }
  return keys;
}
