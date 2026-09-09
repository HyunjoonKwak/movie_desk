"use client";

import type { ID } from "@movie-desk/core";
import { useState } from "react";
import { useT } from "@/i18n/use-t";
import { preservedClips } from "@/persistence/preserved-clips";
import { useEditorStore as useProjectStore } from "@/stores/editor-store";

/**
 * The only way a clip that lost its track position becomes visible again.
 * Without this the count notice returns every session with nothing to act on.
 */
export function PreservedClipsPanel() {
  const project = useProjectStore((s) => s.project);
  const restore = useProjectStore((s) => s.restorePreserved);
  const discard = useProjectStore((s) => s.discardPreserved);
  const [confirming, setConfirming] = useState<ID | null>(null);
  const t = useT();
  const entries = preservedClips(project);

  if (!entries.length)
    return (
      <div className="p-3 text-2xs text-ink-3" data-testid="preserved-empty">
        {t("preserved.empty")}
      </div>
    );

  return (
    <div className="flex h-full flex-col" data-testid="preserved-panel">
      <div className="border-b border-white/5 px-3 py-2 text-2xs text-ink-3">
        {t("preserved.summary", { count: entries.length })}
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto p-2">
        {entries.map(({ clip, timelineId }) => (
          <li
            key={`${timelineId}:${clip.id}`}
            className="rounded border border-white/5 px-2 py-1.5 text-2xs"
            data-testid="preserved-row"
          >
            <div className="truncate text-ink-1">{clip.label ?? clip.kind}</div>
            {confirming === clip.id ? (
              <div className="mt-1.5" data-testid="preserved-confirm">
                <div className="text-ink-1">{t("preserved.confirmTitle")}</div>
                <div className="text-ink-3">{t("preserved.confirmBody")}</div>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    className="rounded bg-red-500/20 px-2 py-1 text-red-300"
                    onClick={() => {
                      discard(clip.id);
                      setConfirming(null);
                    }}
                  >
                    {t("preserved.confirmAction")}
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-ink-3"
                    onClick={() => setConfirming(null)}
                  >
                    {t("preserved.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  className="rounded bg-white/5 px-2 py-1 text-ink-2"
                  onClick={() => {
                    const track = project.timeline.tracks[0];
                    if (track) restore(clip.id, track.id);
                  }}
                >
                  {t("preserved.restore")}
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-1 text-ink-3"
                  onClick={() => setConfirming(clip.id)}
                >
                  {t("preserved.discard")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
