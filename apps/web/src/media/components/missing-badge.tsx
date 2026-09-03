"use client";

import { AlertTriangle } from "lucide-react";
import type { MessageKey } from "@/i18n/messages";
import { useT } from "@/i18n/use-t";
import type { SourceHealth } from "@/media/source/probe-source";

const HINT_KEY: Record<Exclude<SourceHealth, "ok">, MessageKey> = {
  offline: "media.missingOffline",
  moved: "media.missingOffline",
  ambiguous: "media.missingOffline",
  "permission-denied": "media.missingPermission",
  changed: "media.missingChanged",
  unknown: "media.missingUnknown",
};

// Flags a media card whose original could not be read the last time it was
// checked; the title says what to do about it.
export function MissingBadge({ health }: { health: SourceHealth }) {
  const t = useT();
  if (health === "ok") return null;
  return (
    <span
      className="flex items-center gap-0.5 rounded bg-red-500/85 px-1 py-0.5 text-3xs font-medium text-white"
      title={t(HINT_KEY[health])}
      data-missing={health}
    >
      <AlertTriangle className="size-2.5" aria-hidden />
      {t("media.missingBadge")}
    </span>
  );
}
