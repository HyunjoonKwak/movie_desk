"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  FolderOpen,
  FolderUp,
  Music,
  Image as ImageIcon,
  Film,
  Layers,
  Loader2,
  Pin,
  Scissors,
  Search,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { useMediaUiStore } from "@/stores/media-ui-store";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineUiStore } from "@/stores/timeline-ui-store";
import { useMediaImport } from "@/media/hooks";
import { useImportProgressStore } from "@/media/import-progress-store";
import { useAutoEditStore } from "@/autoedit/autoedit-store";
import { reverseGeocode } from "@/autoedit/geocode";
import { groupByDay, sortAssets } from "@/media/organize";
import { useViewStore } from "@/stores/view-store";
import { MediaGroupHeader } from "./media-group-header";
import type { ID } from "@movie-desk/core";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n/use-t";
import type { MediaAsset, MediaKind } from "@movie-desk/core";
import type { SourceHealth } from "@/media/source/probe-source";
import { deleteMediaFile, getStorageUsage } from "@/persistence/opfs";
import { generateProxy } from "@/media/proxy";
import { fmtSec, formatBytes } from "@/media/format";
import { RangeEditor } from "./range-editor";
import { collectDroppedMediaFiles } from "@/media/folder-import";
import { useSourceHealth } from "@/media/use-source-health";
import { ImportFailures } from "./import-failures";
import { MissingBadge } from "./missing-badge";

const KIND_ICON = { video: Film, audio: Music, image: ImageIcon } as const;
const KIND_FILTERS: ReadonlyArray<MediaKind | "all"> = ["all", "video", "audio", "image"];

export function MediaBin() {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const media = useProjectStore((s) => s.project.mediaLibrary);
  const activeAssetId = useMediaUiStore((s) => s.activeAssetId);
  const removeMediaAsset = useProjectStore((s) => s.removeMediaAsset);
  const setAssetProxy = useProjectStore((s) => s.setAssetProxy);
  const { importing, importFiles } = useMediaImport();
  const sourceHealth = useSourceHealth(media);
  const t = useT();
  const [proxying, setProxying] = useState<string | null>(null);

  const makeProxy = useCallback(
    async (asset: MediaAsset) => {
      setProxying(asset.id);
      const toastId = toast.loading(t("media.proxyBuilding"));
      try {
        const result = await generateProxy(asset, (pct) =>
          toast.loading(t("media.proxyProgress", { n: Math.round(pct * 100) }), { id: toastId }),
        );
        if (!result) {
          toast.error(t("media.proxyUnsupported"), { id: toastId });
          return;
        }
        try {
          setAssetProxy(asset.id, result);
        } finally {
          result.releaseLease();
        }
        toast.success(t("media.proxyDone"), { id: toastId });
      } catch (err) {
        toast.error(`${t("media.proxyFailed")}: ${err instanceof Error ? err.message : err}`, {
          id: toastId,
        });
      } finally {
        setProxying(null);
      }
    },
    [setAssetProxy, t],
  );

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MediaKind | "all">("all");
  const [usage, setUsage] = useState<{ usageBytes: number; quotaBytes: number } | null>(null);

  // 썸네일 크기 (0=S, 1=M, 2=L) — localStorage에 유지.
  const [thumbSize, setThumbSize] = useState(1);
  useEffect(() => {
    const v = Number(localStorage.getItem("cut.media.thumbSize"));
    if (v >= 0 && v <= 2) setThumbSize(v);
  }, []);
  useEffect(() => {
    localStorage.setItem("cut.media.thumbSize", String(thumbSize));
  }, [thumbSize]);

  // 다중 선택 (Cmd/Ctrl+클릭, 빈 공간 드래그 마퀴) + 자동 편집 사용/제외 연동.
  const [selected, setSelected] = useState<ReadonlySet<ID>>(new Set());
  const [rangeEditing, setRangeEditing] = useState<ID | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const pinned = useAutoEditStore((s) => s.pinned);
  const excluded = useAutoEditStore((s) => s.excluded);

  const toLocal = useCallback((e: React.PointerEvent) => {
    const el = listRef.current!;
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
  }, []);

  const onMarqueeDown = useCallback(
    (e: React.PointerEvent) => {
      // Cards keep drag-to-timeline; group headers keep their click (pointer
      // capture would otherwise retarget the click to this container).
      if ((e.target as HTMLElement).closest("[data-asset-card], [data-group-header]")) return;
      if (e.button !== 0) return;
      marqueeStart.current = toLocal(e);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [toLocal],
  );

  const onMarqueeMove = useCallback(
    (e: React.PointerEvent) => {
      const start = marqueeStart.current;
      if (!start) return;
      const cur = toLocal(e);
      const rect = {
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      };
      if (rect.w < 4 && rect.h < 4) return;
      setMarquee(rect);
      // 교차하는 카드 선택
      const el = listRef.current!;
      const cRect = el.getBoundingClientRect();
      const next = new Set<ID>();
      for (const li of el.querySelectorAll<HTMLElement>("[data-asset-card]")) {
        const r = li.getBoundingClientRect();
        const lx = r.left - cRect.left + el.scrollLeft;
        const ly = r.top - cRect.top + el.scrollTop;
        const hit =
          lx < rect.x + rect.w &&
          lx + r.width > rect.x &&
          ly < rect.y + rect.h &&
          ly + r.height > rect.y;
        if (hit) next.add(li.dataset.assetCard as ID);
      }
      setSelected(next);
    },
    [toLocal],
  );

  const onMarqueeUp = useCallback(() => {
    if (marqueeStart.current && !marquee) setSelected(new Set()); // 빈 공간 클릭 = 선택 해제
    marqueeStart.current = null;
    setMarquee(null);
  }, [marquee]);

  const toggleSelect = useCallback((id: ID) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-query storage only when the library size changes, not on every metadata edit.
  useEffect(() => {
    void getStorageUsage().then(setUsage);
  }, [media.length]);

  const onChooseFiles = useCallback(() => inputRef.current?.click(), []);
  const onChooseFolder = useCallback(() => folderInputRef.current?.click(), []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      void collectDroppedMediaFiles(e.dataTransfer).then((collected) => {
        if (collected.unreadablePaths.length > 0) {
          toast.warning(t("media.folderUnreadable", { n: collected.unreadablePaths.length }));
        }
        if (collected.candidates.length > 0) void importFiles(collected.candidates);
      });
    },
    [importFiles, t],
  );

  const addToTimeline = useCallback((asset: MediaAsset) => {
    useProjectStore.getState().placeAsset(asset, "append");
  }, []);

  const handleDelete = useCallback(
    (asset: MediaAsset) => {
      // Metadata-only delete: keep the OPFS blob (and proxy) so Undo can fully
      // restore the clip and its media. Orphaned blobs are reclaimed by
      // startup GC once no project — current or saved — references them.
      try {
        removeMediaAsset(asset.id);
        toast.success(t("media.deleted", { name: asset.name }));
      } catch (err) {
        toast.error(`${t("media.deleteFailed")}: ${err instanceof Error ? err.message : err}`);
      }
    },
    [removeMediaAsset, t],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return media.filter(
      (a) =>
        (filter === "all" || a.kind === filter) &&
        (q.length === 0 || a.name.toLowerCase().includes(q)),
    );
  }, [media, query, filter]);

  // "던져 놓으면 정리된다": capture order and day groups are the default view.
  const mediaOrder = useViewStore((s) => s.mediaOrder);
  const groupDays = useViewStore((s) => s.mediaGroupByDay);
  const ordered = useMemo(() => sortAssets(filtered, mediaOrder), [filtered, mediaOrder]);
  const groups = useMemo(
    () => (groupDays ? groupByDay(ordered, reverseGeocode) : null),
    [ordered, groupDays],
  );
  const toggleGroupSelect = useCallback((ids: readonly ID[]) => {
    setSelected((prev) => {
      const all = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="panel-header">
        <span>{t("media.title")}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={onChooseFiles}
            disabled={importing}
          >
            <FolderUp className="size-3.5" />
            {t("media.import")}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={onChooseFolder}
            disabled={importing}
          >
            <FolderOpen className="size-3.5" />
            {t("media.importFolder")}
          </button>
        </div>
      </div>

      <ImportProgress />
      <ImportFailures onRetry={importFiles} />

      {media.length > 0 && (
        <div className="space-y-2 px-2 pb-2" data-testid="media-controls">
          <label className="relative flex items-center">
            <Search className="absolute left-2 size-3 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("media.search")}
              className="w-full rounded bg-white/5 py-1 pl-7 pr-2 text-xs text-ink-1 outline-none focus:bg-white/10"
            />
          </label>
          <div className="grid grid-cols-4 gap-1">
            {KIND_FILTERS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cn(
                  "min-w-0 rounded px-1 py-1 text-2xs uppercase tracking-[0.04em]",
                  filter === k ? "bg-accent text-accent-fg" : "text-ink-3 hover:text-ink-1",
                )}
              >
                {k}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <select
              value={mediaOrder}
              onChange={(e) =>
                useViewStore
                  .getState()
                  .setMediaOrder(e.target.value === "imported" ? "imported" : "captured")
              }
              aria-label={t("media.sort")}
              className="min-w-0 flex-1 rounded bg-white/5 px-1 py-1 text-2xs text-ink-2 outline-none focus:bg-white/10"
            >
              <option value="captured">{t("media.sortCaptured")}</option>
              <option value="imported">{t("media.sortImported")}</option>
            </select>
            <button
              type="button"
              onClick={() => useViewStore.getState().toggleMediaGroupByDay()}
              aria-pressed={groupDays}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-2xs",
                groupDays ? "bg-accent text-accent-fg" : "text-ink-3 hover:text-ink-1",
              )}
            >
              <CalendarDays className="size-3" />
              {t("media.groupByDay")}
            </button>
          </div>
          <div className="flex items-center gap-1.5" title={t("media.thumbSize")}>
            <ZoomOut className="size-3 shrink-0 text-ink-3" />
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={thumbSize}
              onChange={(e) => setThumbSize(Number(e.target.value))}
              className="min-w-0 flex-1 accent-[var(--accent)]"
              aria-label={t("media.thumbSize")}
            />
            <ZoomIn className="size-3 shrink-0 text-ink-3" />
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          onUse={() => useAutoEditStore.getState().markPinned([...selected])}
          onSkip={() => useAutoEditStore.getState().markExcluded([...selected])}
          onClearMarks={() => useAutoEditStore.getState().clearMarks([...selected])}
          onDeselect={() => setSelected(new Set())}
        />
      )}

      <div
        ref={listRef}
        className={cn(
          "relative flex-1 select-none overflow-y-auto p-2",
          "data-[dropping=true]:bg-accent/5",
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onPointerDown={onMarqueeDown}
        onPointerMove={onMarqueeMove}
        onPointerUp={onMarqueeUp}
      >
        {marquee && (
          <div
            className="pointer-events-none absolute z-20 rounded-sm border border-accent bg-accent/10"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          />
        )}
        {media.length === 0 && (
          <button
            type="button"
            onClick={onChooseFiles}
            className="group mx-auto mt-8 flex min-h-52 w-full flex-col items-center justify-center gap-2
                       rounded-lg border border-dashed border-line-strong bg-panel-2/40 px-5 text-center
                       text-ink-3 transition-colors hover:border-accent/55 hover:bg-panel-2 hover:text-ink-2"
          >
            <span className="mb-2 flex size-11 items-center justify-center rounded-lg border border-line-strong bg-panel-2 text-accent transition-colors group-hover:bg-panel-3">
              <FolderUp className="size-5" />
            </span>
            <span className="text-sm font-medium text-ink-1">{t("media.dropHere")}</span>
            <span className="text-2xs">{t("media.browseHere")}</span>
          </button>
        )}

        {filtered.length === 0 && media.length > 0 && (
          <p className="px-2 py-6 text-center text-xs text-ink-3">{t("media.noMatches")}</p>
        )}

        <ul
          className={cn(
            "grid gap-2",
            thumbSize === 0 ? "grid-cols-3" : thumbSize === 2 ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {(groups ?? [{ key: "all", dayStart: null, places: [], assets: ordered }]).map(
            (group) => (
              <Fragment key={group.key}>
                {groups && (
                  <MediaGroupHeader
                    group={group}
                    allSelected={group.assets.every((a) => selected.has(a.id))}
                    onToggle={() => toggleGroupSelect(group.assets.map((a) => a.id))}
                  />
                )}
                {group.assets.map((asset) => {
                  const Icon = KIND_ICON[asset.kind];
                  const isSelected = selected.has(asset.id);
                  const isActive = activeAssetId === asset.id;
                  const isPinned = pinned.includes(asset.id);
                  const isExcluded = excluded.includes(asset.id);
                  const hasRange = asset.useInMs !== undefined || asset.useOutMs !== undefined;
                  return (
                    <li key={asset.id} className="group relative" data-asset-card={asset.id}>
                      <button
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        onClick={(e) => {
                          // Any interaction makes this the E/W/D/Q source asset.
                          useMediaUiStore.getState().setActiveAssetId(asset.id);
                          if (e.metaKey || e.ctrlKey || e.shiftKey) {
                            toggleSelect(asset.id);
                            return;
                          }
                          if (selected.size > 0) {
                            // 선택 모드 중에는 클릭이 선택 토글로 동작 (실수로 타임라인 추가 방지)
                            toggleSelect(asset.id);
                            return;
                          }
                          addToTimeline(asset);
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
                            <img
                              src={asset.thumbDataUrl}
                              alt={asset.name}
                              className="size-full object-cover"
                            />
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
                                asset.livePhoto.role === "still"
                                  ? "media.livePhotoStill"
                                  : "media.livePhotoMotion",
                              )}
                            >
                              LIVE
                            </span>
                          )}
                          <div className="absolute left-1 top-1 flex flex-col items-start gap-0.5">
                            {sourceHealth[asset.id] && (
                              <MissingBadge health={sourceHealth[asset.id] as SourceHealth} />
                            )}
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
                                {fmtSec(asset.useInMs ?? 0)}–
                                {fmtSec(asset.useOutMs ?? asset.durationMs)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 px-2 py-1.5">
                          <Icon className="size-3 shrink-0 text-ink-3" />
                          <span className="truncate text-meta text-ink-1">{asset.name}</span>
                        </div>
                      </button>
                      <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
                        {asset.kind !== "image" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRangeEditing(rangeEditing === asset.id ? null : asset.id);
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
                              void makeProxy(asset);
                            }}
                            disabled={proxying !== null}
                            className="rounded bg-black/60 p-1 text-ink-1 hover:bg-accent/40 hover:text-white disabled:opacity-50"
                            title={t("media.proxy")}
                          >
                            {proxying === asset.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Layers className="size-3" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(asset);
                          }}
                          className="rounded bg-black/60 p-1 text-ink-1 hover:bg-red-500/40 hover:text-red-200"
                          title={t("media.delete")}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </Fragment>
            ),
          )}
        </ul>

        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*,image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={(element) => {
            folderInputRef.current = element;
            element?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          accept="video/*,audio/*,image/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {rangeEditing &&
        (() => {
          const asset = media.find((a) => a.id === rangeEditing);
          if (!asset || asset.kind === "image") return null;
          return <RangeEditor asset={asset} onClose={() => setRangeEditing(null)} />;
        })()}

      {usage && usage.quotaBytes > 0 && (
        <div className="border-t border-line px-2 py-1.5 text-3xs text-ink-3">
          <div className="flex justify-between">
            <span>{t("media.storage")}</span>
            <span className="font-mono">
              {formatBytes(usage.usageBytes)} / {formatBytes(usage.quotaBytes)}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded bg-white/5">
            <div
              className="h-full bg-accent transition-[width]"
              style={{
                width: `${Math.min(100, (usage.usageBytes / usage.quotaBytes) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// 대량 가져오기 진행률 + 중단. hooks.ts의 임포트 루프가 파일 단위로 갱신하며,
// 중단 요청 시 남은 파일을 건너뛴다 (이미 완료된 파일은 유지).
function ImportProgress() {
  const t = useT();
  const { active, total, done, failed, currentName, cancelRequested, requestCancel } =
    useImportProgressStore();
  if (!active) return null;
  const processed = done + failed;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  return (
    <div className="mx-2 mb-2 rounded border border-accent/30 bg-accent/10 p-2 text-2xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ink-1">
          {t("media.importProgress", { done: processed, total })}
        </span>
        <button
          type="button"
          onClick={requestCancel}
          disabled={cancelRequested}
          className="rounded border border-white/15 px-1.5 py-0.5 text-3xs text-ink-1 hover:border-red-400/60 hover:text-red-300 disabled:opacity-50"
        >
          {cancelRequested ? t("media.importStopping") : t("media.importStop")}
        </button>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 truncate text-ink-3">{currentName}</p>
    </div>
  );
}

// 선택된 자산 일괄 처리 바 — 자동 편집의 사용(핀)/제외 지정과 연동.
function BulkBar(props: {
  count: number;
  onUse: () => void;
  onSkip: () => void;
  onClearMarks: () => void;
  onDeselect: () => void;
}) {
  const t = useT();
  return (
    <div className="mx-2 mb-2 flex flex-wrap items-center gap-1 rounded border border-accent/30 bg-accent/10 px-2 py-1 text-2xs">
      <span className="mr-auto whitespace-nowrap font-medium text-ink-1">
        {t("media.selectedCount", { n: props.count })}
      </span>
      <button
        type="button"
        onClick={props.onUse}
        className="flex items-center gap-0.5 whitespace-nowrap rounded bg-accent/80 px-1.5 py-0.5 text-accent-fg hover:bg-accent"
      >
        <Pin className="size-2.5" />
        {t("media.markUse")}
      </button>
      <button
        type="button"
        onClick={props.onSkip}
        className="flex items-center gap-0.5 whitespace-nowrap rounded bg-red-500/70 px-1.5 py-0.5 text-white hover:bg-red-500"
      >
        <X className="size-2.5" />
        {t("media.markSkip")}
      </button>
      <button
        type="button"
        onClick={props.onClearMarks}
        className="whitespace-nowrap rounded border border-white/15 px-1.5 py-0.5 text-ink-1 hover:border-white/40"
      >
        {t("media.unmark")}
      </button>
      <button
        type="button"
        onClick={props.onDeselect}
        className="rounded p-0.5 text-ink-3 hover:text-ink-1"
        title={t("media.deselect")}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

// 사용 구간 편집 드로어 — 필름스트립(영상) 또는 파형(오디오) 위를 드래그해
// in/out을 지정한다. 드래그가 끝날 때 한 번만 커밋해 undo 1회로 남긴다.
