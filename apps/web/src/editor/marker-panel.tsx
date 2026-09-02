"use client";

import { Plus, Trash2, Download, MapPin } from "lucide-react";
import { useProjectStore } from "@/stores/project-store";
import { useT } from "@/i18n/use-t";

// Formats milliseconds as a chapter timestamp: H:MM:SS when over an hour,
// otherwise M:SS. Used both in the list and the chapter export.
const stamp = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

export function MarkerPanel() {
  const markers = useProjectStore((s) => s.project.timeline.markers ?? []);
  const playhead = useProjectStore((s) => s.project.timeline.playhead);
  const projectName = useProjectStore((s) => s.project.name);
  const addMarkerAt = useProjectStore((s) => s.addMarkerAt);
  const removeMarkerById = useProjectStore((s) => s.removeMarkerById);
  const updateMarkerById = useProjectStore((s) => s.updateMarkerById);
  const setPlayheadMs = useProjectStore((s) => s.setPlayheadMs);
  const t = useT();

  const sorted = [...markers].sort((a, b) => a.at - b.at);

  const exportChapters = () => {
    // YouTube-style chapters require a 0:00 first entry; prepend one if absent.
    const lines: string[] = [];
    if (sorted.length === 0 || sorted[0]!.at > 0) lines.push(`0:00 ${t("marker.intro")}`);
    for (const m of sorted) lines.push(`${stamp(m.at)} ${m.label || t("marker.untitled")}`);
    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName || "chapters"}-chapters.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <span className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-ink-3">
          <MapPin className="size-3.5" />
          {t("marker.title")} ({sorted.length})
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => addMarkerAt(playhead, "")}
            title={t("marker.add")}
            className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink-1"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={exportChapters}
            disabled={sorted.length === 0}
            title={t("marker.export")}
            className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink-1 disabled:opacity-40"
          >
            <Download className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {sorted.length === 0 && <p className="px-1 text-2xs text-ink-3">{t("marker.empty")}</p>}
        <ul className="space-y-1">
          {sorted.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded bg-panel-2 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setPlayheadMs(m.at)}
                className="shrink-0 font-mono text-2xs text-accent hover:underline"
                title={t("marker.jump")}
              >
                {stamp(m.at)}
              </button>
              <input
                value={m.label}
                onChange={(e) => updateMarkerById(m.id, { label: e.target.value })}
                placeholder={t("marker.untitled")}
                className="min-w-0 flex-1 bg-transparent text-xs text-ink-1 outline-none placeholder:text-ink-3"
              />
              <input
                type="color"
                value={m.color}
                onChange={(e) => updateMarkerById(m.id, { color: e.target.value })}
                className="size-4 shrink-0 cursor-pointer rounded border-none bg-transparent p-0"
              />
              <button
                type="button"
                onClick={() => removeMarkerById(m.id)}
                className="shrink-0 text-ink-3 hover:text-red-400"
                title={t("marker.delete")}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
