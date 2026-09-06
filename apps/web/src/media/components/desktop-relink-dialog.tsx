"use client";
import { useT } from "@/i18n/use-t";
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import type { DesktopRelinkCandidate } from "../desktop-relink";

export function DesktopRelinkDialog({
  rows,
  onClose,
  onCommit,
}: {
  rows: readonly DesktopRelinkCandidate[];
  onClose: () => void;
  onCommit: (row: DesktopRelinkCandidate) => Promise<boolean>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const pending = rows.filter((row) => row.token && !done.has(row.assetId));
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(90vw,640px)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-white/10 bg-panel-1 p-5 shadow-xl">
          <Dialog.Title>{t("media.relinkFolder")}</Dialog.Title>
          <Dialog.Description className="my-3 text-sm text-ink-2">
            {t("media.relinkFolderDescription")}
          </Dialog.Description>
          <ul className="my-4 space-y-2 text-sm">
            {rows.map((row) => (
              <li key={row.assetId} className="flex justify-between gap-4">
                <span className="break-all">{row.relativePath}</span>
                <span>
                  {done.has(row.assetId)
                    ? t("media.relinkDone")
                    : t(
                        row.verdict === "identical"
                          ? "media.relinkSameFingerprint"
                          : row.verdict === "unavailable"
                            ? "media.relinkUnavailable"
                            : "media.relinkDifferentFingerprint",
                      )}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
              {t("media.relinkClose")}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || pending.length === 0}
              onClick={async () => {
                setBusy(true);
                try {
                  for (const row of pending) {
                    if (await onCommit(row))
                      setDone((previous) => new Set([...previous, row.assetId]));
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("media.relinkConfirmBatch")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
