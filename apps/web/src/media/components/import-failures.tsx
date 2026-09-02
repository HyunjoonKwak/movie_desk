"use client";

import { AlertTriangle, ChevronDown, RotateCcw } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useT, type Translate } from "@/i18n/use-t";
import type { MediaImportCandidate } from "@/media/folder-import";
import { useImportFailureStore } from "@/media/import-failure-store";
import type { MediaImportFailureCode } from "@/media/import-errors";
import { useImportProgressStore } from "@/media/import-progress-store";

const failureMessage = (t: Translate, code: MediaImportFailureCode): string => {
  if (code === "unsupported-media") return t("media.failureUnsupported");
  if (code === "damaged-file") return t("media.failureDamaged");
  if (code === "storage-full") return t("media.failureStorage");
  if (code === "permission-denied") return t("media.failurePermission");
  if (code === "source-missing") return t("media.failureMissing");
  if (code === "desktop-required") return t("media.failureDesktop");
  return t("media.failureUnknown");
};

export function ImportFailures(props: {
  onRetry: (files: readonly MediaImportCandidate[]) => Promise<void>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const { failures, remove, clear } = useImportFailureStore();
  const importActive = useImportProgressStore((state) => state.active);
  if (failures.length === 0) return null;
  const retryable = failures.filter((failure) => failure.retryable);
  const retry = (selected: typeof failures) => {
    if (useImportProgressStore.getState().active) return;
    remove(selected.map((failure) => failure.id));
    void props.onRetry(selected.map((failure) => failure.candidate));
  };

  return (
    <div className="mx-2 mb-2 overflow-hidden rounded border border-amber-400/30 bg-amber-400/5 text-2xs">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <AlertTriangle className="size-3.5 shrink-0 text-amber-300" aria-hidden />
        <button
          type="button"
          className="min-w-0 flex-1 text-left font-medium text-ink-1"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {t("media.failureCount", { n: failures.length })}
        </button>
        {retryable.length > 0 && (
          <button
            type="button"
            className="rounded border border-white/15 px-1.5 py-0.5 text-ink-1 hover:border-accent/50 disabled:opacity-50"
            onClick={() => retry(retryable)}
            disabled={importActive}
          >
            {t("media.retryAll")}
          </button>
        )}
        <button
          type="button"
          className="rounded px-1 py-0.5 text-ink-3 hover:text-ink-1"
          onClick={clear}
          disabled={importActive}
        >
          {t("media.dismissFailures")}
        </button>
        <button
          type="button"
          className="rounded p-0.5 text-ink-3 hover:bg-white/10 hover:text-ink-1"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? t("media.collapseFailures") : t("media.expandFailures")}
        >
          <ChevronDown
            className={cn("size-3 transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
        </button>
      </div>
      {expanded && (
        <ul className="max-h-44 space-y-1 overflow-y-auto border-t border-amber-400/15 p-1.5">
          {failures.map((failure) => (
            <li
              key={failure.id}
              className="flex items-start gap-2 rounded bg-black/15 px-1.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink-1">{failure.candidate.file.name}</p>
                <p className="text-ink-3">{failureMessage(t, failure.code)}</p>
              </div>
              {failure.retryable && (
                <button
                  type="button"
                  className="mt-0.5 rounded p-1 text-ink-2 hover:bg-white/10 hover:text-white disabled:opacity-50"
                  onClick={() => retry([failure])}
                  disabled={importActive}
                  title={t("media.retryFile")}
                >
                  <RotateCcw className="size-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
