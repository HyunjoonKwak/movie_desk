"use client";

import { Layers, Link2, Loader2, Pin, Scissors, Trash2, X } from "lucide-react";
import { Music, Image as ImageIcon, Film } from "lucide-react";
import { memo } from "react";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/cn";
import { fmtSec } from "@/media/format";
import { canRelinkFromFile } from "@/media/relink";
import type { SourceHealth } from "@/media/source/probe-source";
import { useMediaUiStore } from "@/stores/media-ui-store";
import { useTimelineUiStore } from "@/stores/timeline-ui-store";
import type { MediaAsset } from "@movie-desk/core";
import { MissingBadge } from "./missing-badge";

const KIND_ICON = { video: Film, audio: Music, image: ImageIcon } as const;

export interface MediaCardProps {
  readonly asset: MediaAsset;
  readonly isSelected: boolean;
  readonly isActive: boolean;
  readonly isPinned: boolean;
  readonly isExcluded: boolean;
  // Any card selected: a click toggles selection instead of adding.
  readonly selectionMode: boolean;
  readonly health: SourceHealth | undefined;
  readonly rangeEditing: boolean;
  readonly proxy: "idle" | "busy" | "self";
  // Placeholder height for a card that is not rendered yet, so the scroll
  // height does not jump as cards come into view; depends on the grid size.
  readonly estimatedHeight: number;
  readonly onToggleSelect: (assetId: MediaAsset["id"]) => void;
  readonly onAdd: (asset: MediaAsset) => void;
  readonly onToggleRange: (assetId: MediaAsset["id"]) => void;
  readonly onMakeProxy: (asset: MediaAsset) => void;
  readonly onRelink: (asset: MediaAsset) => void;
  readonly onDelete: (asset: MediaAsset) => void;
}

// One library card. Memoised: with a thousand assets on screen, a health
// flush or a selection change must not re-render every card, and offscreen
// cards skip layout and paint (content-visibility) until scrolled into view.
// content-visibility clips paint to the li's padding box, so the li keeps
// 4 px of padding for the selection ring and the focus outline (2 px at
// 2 px offset) that the button paints outside its border.
export const MediaCard = memo(function MediaCard({
  asset,
  isSelected,
  isActive,
  isPinned,
  isExcluded,
  selectionMode,
  health,
  rangeEditing,
  proxy,
  estimatedHeight,
  onToggleSelect,
  onAdd,
  onToggleRange,
  onMakeProxy,
  onRelink,
  onDelete,
}: MediaCardProps) {
  const t = useT();
  const Icon = KIND_ICON[asset.kind];
  const hasRange = asset.useInMs !== undefined || asset.useOutMs !== undefined;
  return (
    <li
      className="group relative p-1"
      data-asset-card={asset.id}
      style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${estimatedHeight}px` }}
    >
      <button
        type="button"
        aria-current={isActive ? "true" : undefined}
        onClick={(e) => {
          // Any interaction makes this the E/W/D/Q source asset.
          useMediaUiStore.getState().setActiveAssetId(asset.id);
          if (e.metaKey || e.ctrlKey || e.shiftKey || selectionMode) {
            // 선택 모드 중에는 클릭이 선택 토글로 동작 (실수로 타임라인 추가 방지)
            onToggleSelect(asset.id);
            return;
          }
          onAdd(asset);
        }}
        draggable
        onDragStart={(e) => {
          // Tracks read the dragged asset from the UI store —
          // dataTransfer is set too for completeness.
          e.dataTransfer.setData("application/x-cut-asset", asset.id);
          e.dataTransfer.effectAllowed = "copy";
          useTimelineUiStore.getState().setDragAssetId(asset.id);
          useMediaUiStore.getState().setActiveAssetId(asset.id);
        }}
        onDragEnd={() => useTimelineUiStore.getState().setDragAssetId(null)}
        className={cn(
          "w-full overflow-hidden rounded-md border text-left transition",
          isSelected
            ? "border-accent ring-2 ring-accent/60"
            : isActive
              ? "border-accent/50 ring-1 ring-accent/30"
              : "border-line hover:border-accent",
          isExcluded ? "opacity-45" : "bg-panel-2",
        )}
        title={t("media.clickToAdd")}
      >
        <div className="relative aspect-video bg-black">
          {asset.thumbDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.thumbDataUrl} alt={asset.name} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-ink-3">
              <Icon className="size-6" />
            </div>
          )}
          {asset.width && asset.height && (
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-3xs font-mono text-white">
              {asset.width}×{asset.height}
            </span>
          )}
          {asset.proxyPath && (
            <span className="absolute bottom-1 left-1 rounded bg-accent/80 px-1 py-0.5 text-3xs font-medium text-white">
              PROXY
            </span>
          )}
          {asset.livePhoto && (
            <span
              className="absolute right-1 top-1 rounded bg-black/70 px-1 py-0.5 text-3xs font-medium text-white"
              title={t(
                asset.livePhoto.role === "still" ? "media.livePhotoStill" : "media.livePhotoMotion",
              )}
            >
              LIVE
            </span>
          )}
          <div className="absolute left-1 top-1 flex flex-col items-start gap-0.5">
            {health && <MissingBadge health={health} />}
            {isPinned && (
              <span className="flex items-center gap-0.5 rounded bg-accent/90 px-1 py-0.5 text-3xs font-medium text-accent-fg">
                <Pin className="size-2.5" />
                {t("media.markUse")}
              </span>
            )}
            {isExcluded && (
              <span className="flex items-center gap-0.5 rounded bg-red-500/85 px-1 py-0.5 text-3xs font-medium text-white">
                <X className="size-2.5" />
                {t("media.markSkip")}
              </span>
            )}
            {hasRange && (
              <span className="flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-3xs font-mono text-amber-300">
                <Scissors className="size-2.5" />
                {fmtSec(asset.useInMs ?? 0)}–{fmtSec(asset.useOutMs ?? asset.durationMs)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <Icon className="size-3 shrink-0 text-ink-3" />
          <span className="truncate text-meta text-ink-1">{asset.name}</span>
        </div>
      </button>
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
        {asset.kind !== "image" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleRange(asset.id);
            }}
            className={cn(
              "rounded bg-black/60 p-1 hover:bg-amber-500/40 hover:text-white",
              hasRange ? "text-amber-300" : "text-ink-1",
            )}
            title={t("media.range")}
          >
            <Scissors className="size-3" />
          </button>
        )}
        {asset.kind === "video" && !asset.proxyPath && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMakeProxy(asset);
            }}
            disabled={proxy !== "idle"}
            className="rounded bg-black/60 p-1 text-ink-1 hover:bg-accent/40 hover:text-white disabled:opacity-50"
            title={t("media.proxy")}
          >
            {proxy === "self" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Layers className="size-3" />
            )}
          </button>
        )}
        {health && canRelinkFromFile(asset) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRelink(asset);
            }}
            className="rounded bg-black/60 p-1 text-amber-200 hover:bg-amber-500/40 hover:text-white"
            title={t("media.relink")}
            data-relink={asset.id}
          >
            <Link2 className="size-3" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(asset);
          }}
          className="rounded bg-black/60 p-1 text-ink-1 hover:bg-red-500/40 hover:text-red-200"
          title={t("media.delete")}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </li>
  );
});
