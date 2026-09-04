"use client";

import { Heart, Pin, X } from "lucide-react";
import { useState } from "react";
import type { ID, ManualCollection, Rating } from "@movie-desk/core";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/cn";
import { parseTagInput } from "@/media/tags";
import { RatingStars } from "./rating-stars";

export interface BulkBarProps {
  readonly count: number;
  // Auto-edit marks.
  readonly onUse: () => void;
  readonly onSkip: () => void;
  readonly onClearMarks: () => void;
  // Library marks: the rating shared by the whole selection (null = mixed or none).
  readonly rating: Rating | null;
  readonly favorite: boolean; // every selected asset is a favourite
  readonly onRate: (rating: Rating | null) => void;
  readonly onFavorite: (favorite: boolean) => void;
  readonly onTag: (tags: readonly string[]) => void;
  readonly selectionTags: readonly string[]; // tags on any selected asset
  readonly onUntag: (tag: string) => void;
  readonly collections: readonly ManualCollection[];
  readonly onAddToCollection: (collectionId: ID) => void;
  readonly onNewCollection: (name: string) => void;
  // The manual collection the bin is filtered by, if any: the selection can
  // be taken out of it.
  readonly collectionFilter: ManualCollection | null;
  readonly onRemoveFromCollection: () => void;
  readonly onDeselect: () => void;
}

const NEW_COLLECTION = "__new__";

// Actions on the current selection: auto-edit use/skip, rating, favourite,
// tags and collections. One row that wraps at narrow widths.
export function BulkBar(props: BulkBarProps) {
  const t = useT();
  const [tagInput, setTagInput] = useState("");
  const [newName, setNewName] = useState<string | null>(null);

  const commitTags = () => {
    const tags = parseTagInput(tagInput);
    if (tags.length === 0) return;
    props.onTag(tags);
    setTagInput("");
  };

  const commitCollection = () => {
    const name = newName?.trim() ?? "";
    if (name === "") return;
    props.onNewCollection(name);
    setNewName(null);
  };

  return (
    <div
      className="mx-2 mb-2 flex flex-wrap items-center gap-1 rounded border border-accent/30 bg-accent/10 px-2 py-1 text-2xs"
      data-testid="bulk-bar"
    >
      <span className="mr-auto flex items-center gap-1 whitespace-nowrap font-medium text-ink-1">
        {t("media.selectedCount", { n: props.count })}
        <button
          type="button"
          onClick={props.onDeselect}
          className="rounded p-0.5 text-ink-3 hover:text-ink-1"
          title={t("media.deselect")}
        >
          <X className="size-3" />
        </button>
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

      <div className="flex w-full flex-wrap items-center gap-1 border-t border-accent/20 pt-1">
        <RatingStars value={props.rating} onChange={props.onRate} />
        <button
          type="button"
          aria-pressed={props.favorite}
          onClick={() => props.onFavorite(!props.favorite)}
          title={props.favorite ? t("media.unfavorite") : t("media.favorite")}
          className={cn(
            "rounded p-0.5",
            props.favorite ? "text-rose-400" : "text-ink-3 hover:text-ink-1",
          )}
          data-testid="bulk-favorite"
        >
          <Heart className={cn("size-3", props.favorite && "fill-current")} />
        </button>
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTags();
            }
          }}
          placeholder={t("media.tagAdd")}
          title={t("media.tagAddHint")}
          aria-label={t("media.tagAdd")}
          className="min-w-0 flex-1 rounded bg-white/5 px-1.5 py-0.5 text-2xs text-ink-1 outline-none focus:bg-white/10"
        />
        {props.collectionFilter && (
          <button
            type="button"
            onClick={props.onRemoveFromCollection}
            className="whitespace-nowrap rounded border border-white/15 px-1.5 py-0.5 text-ink-1 hover:border-red-400/60 hover:text-red-200"
          >
            {t("media.collectionRemoveFrom")}
          </button>
        )}
        {newName === null ? (
          <select
            value=""
            onChange={(e) => {
              const value = e.target.value;
              if (value === NEW_COLLECTION) setNewName("");
              else if (value) props.onAddToCollection(value as ID);
            }}
            aria-label={t("media.collectionAddTo")}
            className="min-w-0 rounded bg-white/5 px-1 py-0.5 text-2xs text-ink-2 outline-none focus:bg-white/10"
          >
            <option value="">{t("media.collectionAddTo")}</option>
            {props.collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
            <option value={NEW_COLLECTION}>{t("media.collectionNew")}</option>
          </select>
        ) : (
          <span className="flex min-w-0 items-center gap-1">
            <input
              // biome-ignore lint/a11y/noAutofocus: the field appears on request
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitCollection();
                } else if (e.key === "Escape") {
                  setNewName(null);
                }
              }}
              placeholder={t("media.collectionNamePlaceholder")}
              aria-label={t("media.collectionNamePlaceholder")}
              className="min-w-0 rounded bg-white/5 px-1.5 py-0.5 text-2xs text-ink-1 outline-none focus:bg-white/10"
            />
            <button
              type="button"
              onClick={commitCollection}
              className="whitespace-nowrap rounded bg-accent/80 px-1.5 py-0.5 text-accent-fg hover:bg-accent"
            >
              {t("media.collectionCreate")}
            </button>
            <button
              type="button"
              onClick={() => setNewName(null)}
              className="rounded p-0.5 text-ink-3 hover:text-ink-1"
              title={t("media.collectionCancel")}
            >
              <X className="size-3" />
            </button>
          </span>
        )}
      </div>
      {props.selectionTags.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-1" data-testid="bulk-tags">
          {props.selectionTags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-0.5 rounded-full border border-line px-1.5 py-0.5 text-3xs text-ink-2"
            >
              #{tag}
              <button
                type="button"
                onClick={() => props.onUntag(tag)}
                aria-label={t("media.tagRemove", { tag })}
                title={t("media.tagRemove", { tag })}
                className="rounded p-0.5 text-ink-3 hover:text-red-300"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
