"use client";

import { useEffect, useMemo } from "react";
import { useT } from "@/i18n/use-t";
import { useSourceHealthStore } from "@/media/source-health-store";
import { isSourceMissing } from "@/media/source/probe-source";
import { selectPlayhead, useProjectStore } from "@/stores/project-store";
import { type MediaAsset, clipsAt } from "@movie-desk/core";

import { StateHint } from "@/components/state-hint";

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
  const firstName = missing[0]!.name;
  const name = firstName.length > 48 ? `${firstName.slice(0, 47)}…` : firstName;
  const names =
    missing.length > 1 ? t("preview.missingMoreNames", { name, n: missing.length - 1 }) : name;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 max-h-full overflow-hidden [&_p]:line-clamp-3 bg-black/80 p-2"
      data-preview-missing
    >
      <StateHint
        tone="error"
        text={`${t("preview.missingMedia", { names })}. ${t("preview.missingHint")}`}
      />
    </div>
  );
}
