"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Filter,
  FolderOpen,
  FolderUp,
  Pin,
  Search,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { useMediaUiStore } from "@/stores/media-ui-store";
import { useProjectStore } from "@/stores/project-store";
import { usePreviewStore } from "@/stores/preview-store";
import { useMediaImport } from "@/media/hooks";
import { useImportProgressStore } from "@/media/import-progress-store";
import { useAutoEditStore } from "@/autoedit/autoedit-store";
import { reverseGeocode } from "@/autoedit/geocode";
import { groupByDay, sortAssets } from "@/media/organize";
import {
  DEFAULT_FILTERS,
  type MediaFilters,
  buildSearchIndex,
  collectPlaces,
  collectTags,
  hasActiveFilters,
  msUntilNextMidnight,
  searchAssets,
} from "@/media/search";
import { filtersFromSpec, filtersToSpec } from "@/media/smart-filters";
import { tagKey } from "@/media/tags";
import { usedAssetIds } from "@/media/usage";
import { useLocaleStore } from "@/i18n/store";
import { useViewStore } from "@/stores/view-store";
import { MediaGroupHeader } from "./media-group-header";
import type { ID } from "@movie-desk/core";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n/use-t";
import type {
  ManualCollection,
  MediaAsset,
  MediaCollection,
  MediaKind,
  Rating,
  SmartCollection,
  Track,
} from "@movie-desk/core";
import { deleteMediaFile, getStorageUsage } from "@/persistence/opfs";
import { generateProxy } from "@/media/proxy";
import { formatBytes } from "@/media/format";
import { RangeEditor } from "./range-editor";
import { collectDroppedMediaFiles } from "@/media/folder-import";
import { useSourceHealth } from "@/media/use-source-health";
import {
  clearStalePreviewsAfterFailedStore,
  compareRelinkCandidate,
  relinkAssetFromFile,
} from "@/media/relink";
import { deleteAssetPreviews } from "@/persistence/previews";
import { countTrash, moveAssetToTrash, reconcileTrash } from "@/persistence/trash";
import { ImportFailures } from "./import-failures";
import { BulkBar } from "./bulk-bar";
import { MediaCard } from "./media-card";
import { MediaFiltersPanel } from "./media-filters-panel";
import { TrashDialog } from "./trash-dialog";

const KIND_FILTERS: ReadonlyArray<MediaKind | "all"> = ["all", "video", "audio", "image"];
// Measured card heights (incl. the li padding) per thumbnail size, used as
// the placeholder for cards that are not rendered yet.
const CARD_HEIGHT_BY_SIZE: readonly [number, number, number] = [78, 113, 198];
const NO_COLLECTIONS: readonly MediaCollection[] = [];
const NO_TRACKS: readonly Track[] = [];

export function MediaBin() {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const media = useProjectStore((s) => s.project.mediaLibrary);
  const projectId = useProjectStore((s) => s.project.id);
  const activeAssetId = useMediaUiStore((s) => s.activeAssetId);
  const removeMediaAsset = useProjectStore((s) => s.removeMediaAsset);
  const relinkMediaAsset = useProjectStore((s) => s.relinkMediaAsset);
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const [relinking, setRelinking] = useState<MediaAsset | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const setAssetProxy = useProjectStore((s) => s.setAssetProxy);
  const collections = useProjectStore((s) => s.project.collections ?? NO_COLLECTIONS);
  const setAssetsRating = useProjectStore((s) => s.setAssetsRating);
  const setAssetsFavorite = useProjectStore((s) => s.setAssetsFavorite);
  const addAssetsTags = useProjectStore((s) => s.addAssetsTags);
  const removeAssetsTag = useProjectStore((s) => s.removeAssetsTag);
  const removeFromCollection = useProjectStore((s) => s.removeFromCollection);
  const createCollection = useProjectStore((s) => s.createCollection);
  const createSmartCollection = useProjectStore((s) => s.createSmartCollection);
  const renameCollection = useProjectStore((s) => s.renameCollection);
  const deleteCollection = useProjectStore((s) => s.deleteCollection);
  const addToCollection = useProjectStore((s) => s.addToCollection);
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
  const [filters, setFilters] = useState<MediaFilters>(DEFAULT_FILTERS);
  // Only the usage filter needs the timeline; subscribing to it otherwise
  // would re-run the whole search on every clip drag frame.
  const usageActive = filters.usage !== "any";
  const tracks = useProjectStore((s) => (usageActive ? s.project.timeline.tracks : NO_TRACKS));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const locale = useLocaleStore((s) => s.locale);
  const filter = filters.kind;
  const setFilter = useCallback(
    (kind: MediaFilters["kind"]) => setFilters((f) => ({ ...f, kind })),
    [],
  );
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
  // Marks shared by the whole selection drive the bulk bar's controls.
  const selectionRating = useMemo<Rating | null>(() => {
    let shared: Rating | null | undefined;
    for (const asset of media) {
      if (!selected.has(asset.id)) continue;
      const rating = asset.rating ?? null;
      if (shared === undefined) shared = rating;
      else if (shared !== rating) return null;
    }
    return shared ?? null;
  }, [media, selected]);
  const selectionFavorite = useMemo(
    () => selected.size > 0 && media.every((asset) => !selected.has(asset.id) || asset.favorite),
    [media, selected],
  );
  const selectionTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const asset of media) {
      if (!selected.has(asset.id)) continue;
      for (const tag of asset.tags ?? []) if (!seen.has(tagKey(tag))) seen.set(tagKey(tag), tag);
    }
    return [...seen.values()];
  }, [media, selected]);
  const tagSelection = useCallback(
    (newTags: readonly string[]) => {
      const ids = [...selected];
      addAssetsTags(ids, newTags);
      const first = newTags[0];
      if (first) toast.success(t("media.tagged", { n: ids.length, tag: first }));
    },
    [selected, addAssetsTags, t],
  );
  const untagSelection = useCallback(
    (tag: string) => removeAssetsTag([...selected], tag),
    [selected, removeAssetsTag],
  );
  const addSelectionToCollection = useCallback(
    (collectionId: ID) => {
      const collection = collections.find((c) => c.id === collectionId);
      if (!collection || collection.kind !== "manual") return;
      const added = [...selected].filter((id) => !collection.assetIds.includes(id));
      addToCollection(collectionId, added);
      toast.success(t("media.collectionAdded", { n: added.length, name: collection.name }));
    },
    [collections, selected, addToCollection, t],
  );
  const collectionFilter = useMemo(
    () =>
      collections.find(
        (c): c is ManualCollection => c.kind === "manual" && c.id === filters.collection,
      ) ?? null,
    [collections, filters.collection],
  );
  const removeSelectionFromCollection = useCallback(() => {
    if (collectionFilter) removeFromCollection(collectionFilter.id, [...selected]);
  }, [collectionFilter, selected, removeFromCollection]);
  // Deleting is undoable, but the media panel gives no other hint that it
  // went through the project history: the toast offers the undo directly,
  // and only while the deletion is still the last edit.
  const deleteCollectionWithUndo = useCallback(
    (collectionId: ID) => {
      const collection = collections.find((c) => c.id === collectionId);
      if (!collection) return;
      deleteCollection(collectionId);
      const { history } = useProjectStore.getState();
      const entry = history.past[history.past.length - 1];
      toast(t("media.collectionDeleted", { name: collection.name }), {
        action: {
          label: t("cmd.undo"),
          onClick: () => {
            const { history: now, undo } = useProjectStore.getState();
            if (now.past[now.past.length - 1] === entry) undo();
          },
        },
      });
    },
    [collections, deleteCollection, t],
  );
  const newCollectionFromSelection = useCallback(
    (name: string) => {
      const id = createCollection(name, [...selected]);
      setFilters((f) => ({ ...f, collection: id }));
      toast.success(t("media.collectionCreated", { name }));
    },
    [createCollection, selected, t],
  );
  const [rangeEditing, setRangeEditing] = useState<ID | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const pinned = useAutoEditStore((s) => s.pinned);
  const excluded = useAutoEditStore((s) => s.excluded);
  // Marks are arrays in the auto-edit store; a Set keeps the per-card lookup
  // constant with a thousand cards.
  const pinnedSet = useMemo(() => new Set<string>(pinned), [pinned]);
  const excludedSet = useMemo(() => new Set<string>(excluded), [excluded]);

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

  const refreshTrashCount = useCallback(() => {
    void countTrash(projectId)
      .then(setTrashCount)
      .catch(() => setTrashCount(0));
  }, [projectId]);

  // Undo after a delete puts the record back; its trash row must go with it.
  useEffect(() => {
    const present = new Set<string>(media.map((asset) => asset.id));
    void reconcileTrash(projectId, present)
      .catch(() => undefined)
      .then(refreshTrashCount);
  }, [media, projectId, refreshTrashCount]);

  const handleDelete = useCallback(
    async (asset: MediaAsset) => {
      // Metadata-only delete: the record goes to the trash (which keeps its
      // OPFS files alive for GC) so it can be restored later; Undo still
      // brings the clips back immediately.
      try {
        await moveAssetToTrash(projectId, asset);
      } catch {
        // No trash store (private mode, storage off): keep the asset rather
        // than delete it with nothing to restore from.
        toast.error(t("media.trashUnavailable", { name: asset.name }));
        return;
      }
      try {
        usePreviewStore.getState().forget([asset.id]);
        removeMediaAsset(asset.id);
        refreshTrashCount();
        toast.success(t("media.movedToTrash", { name: asset.name }));
      } catch (err) {
        toast.error(`${t("media.deleteFailed")}: ${err instanceof Error ? err.message : err}`);
      }
    },
    [projectId, refreshTrashCount, removeMediaAsset, t],
  );

  const applyRelink = useCallback(
    async (asset: MediaAsset, file: File, identical: boolean) => {
      try {
        const patch = await relinkAssetFromFile(asset, file, { identical });
        // If persistence failed, remove old stored rows so migration can fill
        // empty slots; on delete failure keep the inline copy visible.
        await clearStalePreviewsAfterFailedStore(patch.previewsStored, () =>
          deleteAssetPreviews([asset.id]),
        );
        usePreviewStore.getState().forget([asset.id]);
        relinkMediaAsset(asset.id, patch);
        toast.success(t("media.relinked", { name: asset.name }));
      } catch (err) {
        toast.error(`${t("media.relinkFailed")}: ${err instanceof Error ? err.message : err}`);
      }
    },
    [relinkMediaAsset, t],
  );

  const toggleRangeEditing = useCallback((assetId: ID) => {
    setRangeEditing((current) => (current === assetId ? null : assetId));
  }, []);
  const makeProxyStable = useCallback(
    (asset: MediaAsset) => {
      void makeProxy(asset);
    },
    [makeProxy],
  );
  const deleteStable = useCallback(
    (asset: MediaAsset) => {
      void handleDelete(asset);
    },
    [handleDelete],
  );
  const startRelink = useCallback((asset: MediaAsset) => {
    setRelinking(asset);
    const input = relinkInputRef.current;
    if (!input) return;
    // Set imperatively: the chooser opens before the state above has rendered.
    input.accept = `${asset.kind}/*`;
    input.click();
  }, []);

  const onRelinkFileChosen = useCallback(
    (file: File | undefined) => {
      const asset = relinking;
      setRelinking(null);
      if (!asset || !file) return;
      const verdict = compareRelinkCandidate(asset, file);
      if (verdict.ok) {
        void applyRelink(asset, file, true);
        return;
      }
      // Never swap in a look-alike silently: say what differs and let the
      // user decide.
      toast.warning(
        t(verdict.reason === "size" ? "media.relinkMismatchSize" : "media.relinkMismatchName", {
          expected: verdict.expected,
          actual: verdict.actual,
        }),
        {
          duration: 15_000,
          action: {
            label: t("media.relinkAnyway"),
            onClick: () => void applyRelink(asset, file, false),
          },
        },
      );
    },
    [applyRelink, relinking, t],
  );

  // The index is rebuilt only when the library changes; each keystroke or
  // filter change is a pass over precomputed text.
  const searchIndex = useMemo(
    () => buildSearchIndex(media, reverseGeocode, locale),
    [media, locale],
  );
  const places = useMemo(() => collectPlaces(searchIndex), [searchIndex]);
  // Period filters compare against a clock that ticks at local midnight, so
  // "Today" does not keep showing yesterday in a window left open.
  const [today, setToday] = useState(() => Date.now());
  useEffect(() => {
    const timer = setTimeout(() => setToday(Date.now()), msUntilNextMidnight(today) + 1_000);
    return () => clearTimeout(timer);
  }, [today]);
  // A place that left the library (trashed, other project) must not keep
  // filtering from a select that no longer offers it.
  useEffect(() => {
    if (filters.place !== null && !places.includes(filters.place)) {
      setFilters((f) => ({ ...f, place: null }));
    }
  }, [filters.place, places]);
  const tags = useMemo(() => collectTags(searchIndex, locale), [searchIndex, locale]);
  const used = useMemo(
    () => (usageActive ? usedAssetIds(tracks) : undefined),
    [usageActive, tracks],
  );
  const manualCollections = useMemo(
    () => collections.filter((c): c is ManualCollection => c.kind === "manual"),
    [collections],
  );
  const collectionMembers = useMemo(
    () => new Map(manualCollections.map((c) => [c.id, new Set(c.assetIds)] as const)),
    [manualCollections],
  );
  // A deleted collection must not keep filtering from a select that no
  // longer offers it.
  useEffect(() => {
    if (filters.collection !== null && !collectionMembers.has(filters.collection)) {
      setFilters((f) => ({ ...f, collection: null }));
    }
  }, [filters.collection, collectionMembers]);
  const filtered = useMemo(
    () =>
      searchAssets(searchIndex, media, query, filters, {
        now: today,
        used,
        collections: collectionMembers,
      }),
    [searchIndex, media, query, filters, today, used, collectionMembers],
  );
  const filtersActive = hasActiveFilters(filters);
  const resetSearch = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setQuery("");
  }, []);
  const loadSmartCollection = useCallback(
    (collection: SmartCollection) => {
      setQuery(collection.query);
      setFilters(filtersFromSpec(collection.filters));
      toast.success(t("media.collectionLoaded", { name: collection.name }));
    },
    [t],
  );
  const saveSmartCollection = useCallback(
    (name: string) => {
      createSmartCollection(name, query, filtersToSpec(filters));
      toast.success(t("media.collectionCreated", { name }));
    },
    [createSmartCollection, query, filters, t],
  );

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
              className="w-full rounded bg-white/5 py-1 pl-7 pr-8 text-xs text-ink-1 outline-none focus:bg-white/10"
            />
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-pressed={filtersOpen}
              aria-label={t("media.filters")}
              title={t("media.filters")}
              className={cn(
                "absolute right-1 rounded p-1",
                filtersActive || filtersOpen ? "text-accent" : "text-ink-3 hover:text-ink-1",
              )}
            >
              <Filter className="size-3" />
            </button>
          </label>
          {filtersOpen && (
            <MediaFiltersPanel
              filters={filters}
              query={query}
              setFilters={setFilters}
              places={places}
              tags={tags}
              collections={collections}
              shown={filtered.length}
              total={media.length}
              canReset={filtersActive || query !== ""}
              onReset={resetSearch}
              onLoadSmart={loadSmartCollection}
              onSaveSmart={saveSmartCollection}
              onRenameCollection={renameCollection}
              onDeleteCollection={deleteCollectionWithUndo}
            />
          )}
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
          rating={selectionRating}
          favorite={selectionFavorite}
          onRate={(rating) => setAssetsRating([...selected], rating)}
          onFavorite={(favorite) => setAssetsFavorite([...selected], favorite)}
          onTag={tagSelection}
          selectionTags={selectionTags}
          onUntag={untagSelection}
          collections={manualCollections}
          onAddToCollection={addSelectionToCollection}
          onNewCollection={newCollectionFromSelection}
          collectionFilter={collectionFilter}
          onRemoveFromCollection={removeSelectionFromCollection}
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
            "grid gap-1",
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
                {group.assets.map((asset) => (
                  <MediaCard
                    key={asset.id}
                    asset={asset}
                    isSelected={selected.has(asset.id)}
                    isActive={activeAssetId === asset.id}
                    isPinned={pinnedSet.has(asset.id)}
                    isExcluded={excludedSet.has(asset.id)}
                    selectionMode={selected.size > 0}
                    health={sourceHealth[asset.id]}
                    rangeEditing={rangeEditing === asset.id}
                    proxy={proxying === null ? "idle" : proxying === asset.id ? "self" : "busy"}
                    estimatedHeight={
                      CARD_HEIGHT_BY_SIZE[thumbSize as 0 | 1 | 2] ?? CARD_HEIGHT_BY_SIZE[1]
                    }
                    onToggleSelect={toggleSelect}
                    onAdd={addToTimeline}
                    onToggleRange={toggleRangeEditing}
                    onMakeProxy={makeProxyStable}
                    onRelink={startRelink}
                    onDelete={deleteStable}
                  />
                ))}
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

      <input
        ref={relinkInputRef}
        type="file"
        className="hidden"
        data-relink-input
        onChange={(e) => {
          onRelinkFileChosen(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} onChanged={refreshTrashCount} />
      <div className="flex items-center justify-between border-t border-line px-2 py-1 text-3xs text-ink-3">
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white/5 hover:text-ink-1"
          onClick={() => setTrashOpen(true)}
        >
          <Trash2 className="size-3" aria-hidden />
          {t("media.trash")} ({trashCount})
        </button>
      </div>

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

// 사용 구간 편집 드로어 — 필름스트립(영상) 또는 파형(오디오) 위를 드래그해
// in/out을 지정한다. 드래그가 끝날 때 한 번만 커밋해 undo 1회로 남긴다.
