"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useT } from "@/i18n/use-t";
import { useSourceHealthStore } from "@/media/source-health-store";
import { isSourceMissing } from "@/media/source/probe-source";
import { selectPlayhead, useProjectStore } from "@/stores/project-store";
import { type MediaAsset, clipsAt } from "@movie-desk/core";

// The compositor draws nothing for a clip whose original cannot be read, so
// the preview would just go black. This names the missing files for the
// clips under the playhead and asks the health store to (re)check them, so
// the notice also works when the media bin is not on screen.

export function MissingMediaNotice() {
  const project = useProjectStore((s) => s.project);
  const playhead = useProjectStore(selectPlayhead);
  const entries = useSourceHealthStore((s) => s.entries);
  const check = useSourceHealthStore((s) => s.check);
  const t = useT();

  const byId = useMemo(
    () => new Map(project.mediaLibrary.map((asset) => [asset.id, asset])),
    [project.mediaLibrary],
  );
  const assetsAtPlayhead = useMemo(() => {
    const seen = new Set<string>();
    const assets: MediaAsset[] = [];
    for (const clip of clipsAt(project.timeline, playhead)) {
      if (clip.kind !== "media" || seen.has(clip.assetId)) continue;
      seen.add(clip.assetId);
      const asset = byId.get(clip.assetId);
      if (asset) assets.push(asset);
    }
    return assets;
  }, [project.timeline, playhead, byId]);

  // Only assets never checked yet: the playhead moves every frame during
  // playback, and the library hook already keeps checked entries fresh.
  const unchecked = assetsAtPlayhead.filter((asset) => !entries[asset.id]);
  const uncheckedKey = unchecked.map((asset) => asset.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run only when the set of unchecked ids changes, not on every array identity.
  useEffect(() => {
    if (unchecked.length > 0) void check(unchecked);
  }, [uncheckedKey, check]);

  const missing = assetsAtPlayhead.filter((asset) => isSourceMissing(entries[asset.id]?.health));
  if (missing.length === 0) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3"
      data-preview-missing
    >
      <div className="max-w-full rounded-md border border-red-400/40 bg-black/75 px-3 py-2 text-2xs text-ink-1 shadow-lg backdrop-blur">
        <div className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="size-3.5 text-red-400" aria-hidden />
          <span className="truncate">
            {t("preview.missingMedia", { names: missing.map((asset) => asset.name).join(", ") })}
          </span>
        </div>
        <div className="mt-0.5 text-ink-3">{t("preview.missingHint")}</div>
      </div>
    </div>
  );
}
