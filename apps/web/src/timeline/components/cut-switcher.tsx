"use client";

import { useT } from "@/i18n/use-t";
import { useEditorStore as useProjectStore } from "@/stores/editor-store";
import { type ID, listCuts } from "@movie-desk/core";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

// Which cut of this project the timeline shows. One library, several cuts:
// pick one, name it, start another, copy the current one, or drop it.
export function CutSwitcher() {
  const t = useT();
  const timelines = useProjectStore((s) => s.project.timelines);
  const rootTimelineId = useProjectStore((s) => s.project.rootTimelineId);
  const createCut = useProjectStore((s) => s.createCut);
  const switchCut = useProjectStore((s) => s.switchCut);
  const renameCut = useProjectStore((s) => s.renameCut);
  const duplicateCut = useProjectStore((s) => s.duplicateCut);
  const deleteCut = useProjectStore((s) => s.deleteCut);
  const cuts = useMemo(
    () => listCuts({ timelines, rootTimelineId } as Parameters<typeof listCuts>[0]),
    [timelines, rootTimelineId],
  );
  const index = Math.max(
    0,
    cuts.findIndex((cut) => cut.id === rootTimelineId),
  );
  const active = cuts[index];
  const label = (cut: (typeof cuts)[number], i: number): string =>
    cut.name ?? t("cuts.untitled", { n: i + 1 });
  const [draft, setDraft] = useState(active?.name ?? "");
  useEffect(() => setDraft(active?.name ?? ""), [active?.name]);
  const commit = (value: string) => {
    if (active && value.trim() !== (active.name ?? "")) renameCut(active.id, value);
  };

  return (
    <div className="flex shrink-0 items-center gap-1" data-testid="cut-switcher">
      <select
        aria-label={t("cuts.title")}
        value={rootTimelineId}
        onChange={(e) => switchCut(e.target.value as ID)}
        className="max-w-36 rounded-md border border-line bg-panel-2 px-1.5 py-0.5 text-2xs text-ink-1 outline-none focus:border-line-strong"
        data-testid="cut-select"
      >
        {cuts.map((cut, i) => (
          <option key={cut.id} value={cut.id} className="bg-panel-2">
            {label(cut, i)}
          </option>
        ))}
      </select>
      <input
        value={draft}
        placeholder={active ? label(active, index) : ""}
        aria-label={t("cuts.rename")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setDraft(active?.name ?? "");
            e.currentTarget.blur();
          }
        }}
        className="w-24 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-2xs text-ink-1 outline-none hover:border-line focus:border-line-strong focus:bg-panel-2"
        data-testid="cut-name"
      />
      <button
        type="button"
        className="btn-ghost px-1.5 py-0.5 text-2xs"
        onClick={() => createCut()}
        title={t("cuts.new")}
        aria-label={t("cuts.new")}
        data-testid="cut-new"
      >
        <Plus className="size-3" />
      </button>
      <button
        type="button"
        className="btn-ghost px-1.5 py-0.5 text-2xs"
        onClick={() => duplicateCut(rootTimelineId)}
        title={t("cuts.duplicate")}
        aria-label={t("cuts.duplicate")}
        data-testid="cut-duplicate"
      >
        <Copy className="size-3" />
      </button>
      <button
        type="button"
        className="btn-ghost px-1.5 py-0.5 text-2xs"
        onClick={() => deleteCut(rootTimelineId)}
        disabled={cuts.length < 2}
        title={t("cuts.delete")}
        aria-label={t("cuts.delete")}
        data-testid="cut-delete"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}
