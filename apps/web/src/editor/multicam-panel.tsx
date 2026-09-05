"use client";

import { useMemo, useState } from "react";
import { Clapperboard } from "lucide-react";
import { toast } from "sonner";
import type { MulticamAngle } from "@movie-desk/core";
import { useAssetThumbs } from "@/stores/preview-store";
import { useProjectStore, selectPlayhead } from "@/stores/project-store";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/cn";

// Pick video assets as angles, build a program, then click an angle to cut
// to it at the playhead.
export function MulticamPanel() {
  const media = useProjectStore((s) => s.project.mediaLibrary);
  const createMulticam = useProjectStore((s) => s.createMulticam);
  const switchAngle = useProjectStore((s) => s.switchMulticamAngle);
  const playhead = useProjectStore(selectPlayhead);
  const t = useT();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const videoAssets = useMemo(() => media.filter((a) => a.kind === "video"), [media]);
  const thumbs = useAssetThumbs(videoAssets);

  const angles: MulticamAngle[] = useMemo(
    () =>
      videoAssets
        .filter((a) => selected.has(a.id))
        .map((a) => ({ assetId: a.id, offsetMs: 0, label: a.name })),
    [videoAssets, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onCreate = () => {
    if (angles.length < 2) {
      toast.error(t("multicam.needTwo"));
      return;
    }
    const longest = videoAssets
      .filter((a) => selected.has(a.id))
      .reduce((m, a) => Math.max(m, a.durationMs), 0);
    createMulticam(angles, longest);
    toast.success(t("multicam.created", { n: angles.length }));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="panel-header">
        <span className="flex items-center gap-2">
          <Clapperboard className="size-3.5" />
          {t("multicam.title")}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {videoAssets.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-ink-3">{t("multicam.noVideo")}</p>
        ) : (
          <>
            <p className="mb-2 px-1 text-2xs text-ink-3">{t("multicam.pickAngles")}</p>
            <ul className="grid grid-cols-2 gap-2">
              {videoAssets.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => toggle(a.id)}
                    className={cn(
                      "w-full overflow-hidden rounded-md border text-left",
                      selected.has(a.id) ? "border-accent" : "border-white/5",
                    )}
                  >
                    <div className="aspect-video bg-black">
                      {thumbs[a.id] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbs[a.id]} alt={a.name} className="size-full object-cover" />
                      )}
                    </div>
                    <span className="block truncate px-2 py-1 text-2xs text-ink-1">{a.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={onCreate} className="btn-primary mt-3 w-full text-xs">
              {t("multicam.create")}
            </button>

            {angles.length > 0 && (
              <>
                <p className="mb-2 mt-4 px-1 text-2xs text-ink-3">{t("multicam.switchHint")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {angles.map((angle) => (
                    <button
                      key={angle.assetId}
                      type="button"
                      onClick={() => switchAngle(playhead, angle)}
                      className="rounded-md border border-white/5 bg-panel-2 px-2 py-3 text-xs text-ink-1 hover:border-accent hover:text-accent"
                    >
                      {angle.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
