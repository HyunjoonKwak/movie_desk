"use client";

import { useState } from "react";
import { Music2, Plus, X } from "lucide-react";
import { useT } from "@/i18n/use-t";
import { useMusicLibraryStore } from "@/stores/music-library-store";
import { useProjectStore } from "@/stores/project-store";
import { MusicAddForm } from "./music-add-form";
import { MusicFreeSearch } from "./music-free-search";
import { MusicRecommend } from "./music-recommend";
import { MusicRefCard } from "./music-ref-card";

export function MusicPanel() {
  const refs = useMusicLibraryStore((s) => s.refs);
  const projectId = useProjectStore((s) => s.project.id);
  const [adding, setAdding] = useState(false);
  const t = useT();

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <span className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-ink-3">
          <Music2 className="size-3.5" />
          {t("music.library")} ({refs.length})
        </span>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          title={t("music.addTitle")}
          className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink-1"
        >
          {adding ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
        </button>
      </div>
      {adding && <MusicAddForm onDone={() => setAdding(false)} />}
      {/* Remount on project switch so the context-tag preselection follows. */}
      <MusicRecommend key={projectId} />
      <MusicFreeSearch />
      <div className="flex flex-col gap-2 p-3">
        {refs.length === 0 && !adding && <p className="text-xs text-ink-3">{t("music.empty")}</p>}
        {refs.map((r) => (
          <MusicRefCard key={r.id} musicRef={r} />
        ))}
      </div>
    </div>
  );
}
