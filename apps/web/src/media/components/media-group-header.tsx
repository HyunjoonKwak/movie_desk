"use client";

import { useT } from "@/i18n/use-t";
import { useLocaleStore } from "@/i18n/store";
import { AUDIO_GROUP, UNDATED_GROUP, formatDayLabel, type MediaDayGroup } from "@/media/organize";
import { cn } from "@/lib/cn";
import { CheckSquare, Square } from "lucide-react";

// One row above each day in the media bin: "8월 12일 (수) · 서울 · 강릉 · 12개".
// Clicking it selects (or deselects) the whole day so the bulk 사용/제외 bar
// can act on a day at a time.
export function MediaGroupHeader({
  group,
  allSelected,
  onToggle,
}: {
  group: MediaDayGroup;
  allSelected: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const title =
    group.key === UNDATED_GROUP
      ? t("media.groupUndated")
      : group.key === AUDIO_GROUP
        ? t("media.groupAudio")
        : formatDayLabel(group.dayStart ?? 0, locale);
  const Icon = allSelected ? CheckSquare : Square;
  return (
    <li className="col-span-full pt-1 first:pt-0" data-group-header={group.key}>
      <button
        type="button"
        onClick={onToggle}
        title={t("media.selectGroup")}
        aria-pressed={allSelected}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-3xs",
          allSelected ? "text-accent" : "text-ink-3 hover:text-ink-1",
        )}
      >
        <Icon className="size-3 shrink-0" />
        <span className="font-medium text-ink-2">{title}</span>
        {group.places.map((place) => (
          <span key={place} className="truncate">
            · {place}
          </span>
        ))}
        <span className="ml-auto shrink-0 font-mono">
          {t("media.groupCount", { n: group.assets.length })}
        </span>
      </button>
    </li>
  );
}
