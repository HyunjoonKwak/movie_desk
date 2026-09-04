"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ID, MediaCollection, SmartCollection } from "@movie-desk/core";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/cn";
import { type MediaFilters, RESOLUTION_LABEL, type TagCount } from "@/media/search";

export interface MediaFiltersPanelProps {
  readonly filters: MediaFilters;
  readonly setFilters: (update: (filters: MediaFilters) => MediaFilters) => void;
  readonly places: readonly string[];
  readonly tags: readonly TagCount[];
  readonly collections: readonly MediaCollection[];
  readonly shown: number;
  readonly total: number;
  readonly canReset: boolean; // a query or a filter is active
  readonly onReset: () => void;
  readonly onLoadSmart: (collection: SmartCollection) => void;
  readonly onSaveSmart: (name: string) => void;
  readonly onRenameCollection: (collectionId: ID, name: string) => void;
  readonly onDeleteCollection: (collectionId: ID) => void;
}

const SELECT =
  "min-w-0 rounded bg-white/5 px-1 py-1 text-2xs text-ink-2 outline-none focus:bg-white/10";
const SMART_PREFIX = "smart:";
// Tag chips shown before "more": a real library can carry hundreds of tags.
const TAG_CHIP_LIMIT = 12;

// The filter panel under the search box. Selecting a manual collection
// filters by membership; selecting a smart one loads its saved search into
// the query and filters instead (it is a search, not a list).
export function MediaFiltersPanel(props: MediaFiltersPanelProps) {
  const { filters, setFilters, collections } = props;
  const t = useT();
  const [smartName, setSmartName] = useState<string | null>(null);
  // The collection last chosen in the select. Kept apart from the filters:
  // a smart collection is applied as a search and is not a filter value,
  // but it still has to be renameable and deletable.
  const [picked, setPicked] = useState<ID | null>(null);
  const [renaming, setRenaming] = useState<{ id: ID; name: string } | null>(null);
  const [allTags, setAllTags] = useState(false);
  const pickedCollection = collections.find((c) => c.id === picked) ?? null;
  useEffect(() => {
    if (picked !== null && !collections.some((c) => c.id === picked)) setPicked(null);
  }, [picked, collections]);
  // The membership filter is also set from outside (a new collection made
  // from the selection) and cleared from outside (a deleted collection).
  useEffect(() => {
    if (filters.collection !== null) setPicked(filters.collection);
    else if (pickedCollection?.kind === "manual") setPicked(null);
  }, [filters.collection, pickedCollection]);
  const selectValue =
    pickedCollection === null
      ? ""
      : pickedCollection.kind === "smart"
        ? `${SMART_PREFIX}${pickedCollection.id}`
        : pickedCollection.id;
  const visibleTags = allTags ? props.tags : props.tags.slice(0, TAG_CHIP_LIMIT);

  const commitSmart = () => {
    const name = smartName?.trim() ?? "";
    if (name === "") return;
    props.onSaveSmart(name);
    setSmartName(null);
  };
  const commitRename = () => {
    if (renaming === null) return;
    const name = renaming.name.trim();
    if (name !== "") props.onRenameCollection(renaming.id, name);
    setRenaming(null);
  };

  return (
    <div className="grid grid-cols-2 gap-1" data-testid="media-filters">
      <select
        value={filters.period}
        onChange={(e) =>
          setFilters((f) => ({ ...f, period: e.target.value as MediaFilters["period"] }))
        }
        aria-label={t("media.filterPeriod")}
        className={SELECT}
      >
        <option value="any">{t("media.filterPeriodAny")}</option>
        <option value="today">{t("media.filterPeriodToday")}</option>
        <option value="week">{t("media.filterPeriodWeek")}</option>
        <option value="month">{t("media.filterPeriodMonth")}</option>
        <option value="year">{t("media.filterPeriodYear")}</option>
      </select>
      <select
        value={filters.duration}
        onChange={(e) =>
          setFilters((f) => ({ ...f, duration: e.target.value as MediaFilters["duration"] }))
        }
        aria-label={t("media.filterDuration")}
        className={SELECT}
      >
        <option value="any">{t("media.filterDurationAny")}</option>
        <option value="short">{t("media.filterDurationShort")}</option>
        <option value="medium">{t("media.filterDurationMedium")}</option>
        <option value="long">{t("media.filterDurationLong")}</option>
      </select>
      <select
        value={filters.resolution}
        onChange={(e) =>
          setFilters((f) => ({ ...f, resolution: e.target.value as MediaFilters["resolution"] }))
        }
        aria-label={t("media.filterResolution")}
        className={SELECT}
      >
        <option value="any">{t("media.filterResolutionAny")}</option>
        {(["uhd", "fhd", "hd", "sd"] as const).map((r) => (
          <option key={r} value={r}>
            {RESOLUTION_LABEL[r]}
          </option>
        ))}
      </select>
      <select
        value={filters.audio}
        onChange={(e) =>
          setFilters((f) => ({ ...f, audio: e.target.value as MediaFilters["audio"] }))
        }
        aria-label={t("media.filterAudio")}
        className={SELECT}
      >
        <option value="any">{t("media.filterAudioAny")}</option>
        <option value="with">{t("media.filterAudioWith")}</option>
        <option value="without">{t("media.filterAudioWithout")}</option>
      </select>
      <select
        value={filters.minRating}
        onChange={(e) =>
          setFilters((f) => ({
            ...f,
            minRating: Number(e.target.value) as MediaFilters["minRating"],
          }))
        }
        aria-label={t("media.filterRating")}
        className={SELECT}
      >
        <option value={0}>{t("media.filterRatingAny")}</option>
        {([5, 4, 3, 2, 1] as const).map((n) => (
          <option key={n} value={n}>
            {t("media.filterRatingMin", { n })}
          </option>
        ))}
      </select>
      <select
        value={filters.usage}
        onChange={(e) =>
          setFilters((f) => ({ ...f, usage: e.target.value as MediaFilters["usage"] }))
        }
        aria-label={t("media.filterUsage")}
        className={SELECT}
      >
        <option value="any">{t("media.filterUsageAny")}</option>
        <option value="used">{t("media.filterUsageUsed")}</option>
        <option value="unused">{t("media.filterUsageUnused")}</option>
      </select>
      {props.places.length > 0 && (
        <select
          value={filters.place ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, place: e.target.value || null }))}
          aria-label={t("media.filterPlace")}
          className={cn(SELECT, "col-span-2")}
        >
          <option value="">{t("media.filterPlaceAny")}</option>
          {props.places.map((place) => (
            <option key={place} value={place}>
              {place}
            </option>
          ))}
        </select>
      )}
      <label className="col-span-2 flex items-center gap-1.5 text-2xs text-ink-2">
        <input
          type="checkbox"
          checked={filters.favorite}
          onChange={(e) => setFilters((f) => ({ ...f, favorite: e.target.checked }))}
          className="accent-accent"
        />
        {t("media.filterFavorite")}
      </label>
      {props.tags.length > 0 && (
        <div
          className="col-span-2 flex flex-wrap items-center gap-1"
          data-testid="media-tag-filters"
        >
          <span className="text-3xs text-ink-3">{t("media.filterTags")}</span>
          {visibleTags.map(({ tag, count }) => {
            const active = filters.tags.some(
              (x) => x.toLocaleLowerCase() === tag.toLocaleLowerCase(),
            );
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    tags: active
                      ? f.tags.filter((x) => x.toLocaleLowerCase() !== tag.toLocaleLowerCase())
                      : [...f.tags, tag],
                  }))
                }
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-3xs",
                  active
                    ? "border-accent bg-accent/20 text-ink-1"
                    : "border-line text-ink-2 hover:border-accent/60",
                )}
              >
                #{tag} <span className="text-ink-3">{count}</span>
              </button>
            );
          })}
          {props.tags.length > TAG_CHIP_LIMIT && (
            <button
              type="button"
              onClick={() => setAllTags((v) => !v)}
              className="rounded px-1 py-0.5 text-3xs text-ink-3 hover:text-ink-1"
            >
              {allTags
                ? t("media.tagsLess")
                : t("media.tagsMore", { n: props.tags.length - TAG_CHIP_LIMIT })}
            </button>
          )}
        </div>
      )}
      <div className="col-span-2 flex items-center gap-1">
        <select
          value={selectValue}
          onChange={(e) => {
            const value = e.target.value;
            if (value.startsWith(SMART_PREFIX)) {
              const smart = collections.find(
                (c): c is SmartCollection =>
                  c.kind === "smart" && c.id === value.slice(SMART_PREFIX.length),
              );
              if (!smart) return;
              setPicked(smart.id);
              props.onLoadSmart(smart);
              return;
            }
            setPicked(value ? (value as ID) : null);
            setFilters((f) => ({ ...f, collection: value ? (value as ID) : null }));
          }}
          aria-label={t("media.collection")}
          className={cn(SELECT, "flex-1")}
        >
          <option value="">{t("media.collectionAny")}</option>
          {collections.some((c) => c.kind === "manual") && (
            <optgroup label={t("media.collection")}>
              {collections.map((collection) =>
                collection.kind === "manual" ? (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ) : null,
              )}
            </optgroup>
          )}
          {collections.some((c) => c.kind === "smart") && (
            <optgroup label={t("media.collectionSmart")}>
              {collections.map((collection) =>
                collection.kind === "smart" ? (
                  <option key={collection.id} value={`${SMART_PREFIX}${collection.id}`}>
                    {t("media.collectionSmart")}: {collection.name}
                  </option>
                ) : null,
              )}
            </optgroup>
          )}
        </select>
        {pickedCollection && renaming === null && (
          <>
            <button
              type="button"
              onClick={() => setRenaming({ id: pickedCollection.id, name: pickedCollection.name })}
              className="rounded p-1 text-ink-3 hover:text-ink-1"
              aria-label={t("media.collectionRename")}
              title={t("media.collectionRename")}
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => props.onDeleteCollection(pickedCollection.id)}
              className="rounded p-1 text-ink-3 hover:text-red-300"
              aria-label={t("media.collectionDelete")}
              title={t("media.collectionDelete")}
            >
              <Trash2 className="size-3" />
            </button>
          </>
        )}
      </div>
      {renaming !== null && (
        <div className="col-span-2 flex items-center gap-1">
          <input
            // biome-ignore lint/a11y/noAutofocus: the field appears on request
            autoFocus
            value={renaming.name}
            onChange={(e) => setRenaming({ id: renaming.id, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") setRenaming(null);
            }}
            aria-label={t("media.collectionRename")}
            className="min-w-0 flex-1 rounded bg-white/5 px-1.5 py-1 text-2xs text-ink-1 outline-none focus:bg-white/10"
          />
          <button
            type="button"
            onClick={commitRename}
            className="rounded bg-accent/80 px-1.5 py-0.5 text-2xs text-accent-fg hover:bg-accent"
          >
            {t("media.collectionSave")}
          </button>
        </div>
      )}
      <div className="col-span-2 flex items-center justify-between gap-1 text-3xs text-ink-3">
        <span data-testid="media-match-count">
          {t("media.matchCount", { shown: props.shown, total: props.total })}
        </span>
        <span className="flex items-center gap-1">
          {props.canReset && smartName === null && (
            <button
              type="button"
              className="rounded px-1 py-0.5 hover:text-ink-1"
              onClick={() => setSmartName("")}
            >
              {t("media.collectionSaveSmart")}
            </button>
          )}
          {props.canReset && (
            <button
              type="button"
              className="rounded px-1 py-0.5 hover:text-ink-1"
              onClick={() => {
                setPicked(null);
                props.onReset();
              }}
            >
              {t("media.filterReset")}
            </button>
          )}
        </span>
      </div>
      {smartName !== null && (
        <div className="col-span-2 flex items-center gap-1">
          <input
            // biome-ignore lint/a11y/noAutofocus: the field appears on request
            autoFocus
            value={smartName}
            onChange={(e) => setSmartName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitSmart();
              } else if (e.key === "Escape") setSmartName(null);
            }}
            placeholder={t("media.collectionNamePlaceholder")}
            aria-label={t("media.collectionSaveSmart")}
            className="min-w-0 flex-1 rounded bg-white/5 px-1.5 py-1 text-2xs text-ink-1 outline-none focus:bg-white/10"
          />
          <button
            type="button"
            onClick={commitSmart}
            className="rounded bg-accent/80 px-1.5 py-0.5 text-2xs text-accent-fg hover:bg-accent"
          >
            {t("media.collectionSave")}
          </button>
          <button
            type="button"
            onClick={() => setSmartName(null)}
            className="rounded px-1 py-0.5 text-2xs hover:text-ink-1"
          >
            {t("media.collectionCancel")}
          </button>
        </div>
      )}
    </div>
  );
}
