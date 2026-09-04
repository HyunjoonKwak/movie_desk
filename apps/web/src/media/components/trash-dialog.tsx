"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t";
import {
  type TrashEntry,
  deleteTrashEntry,
  emptyTrash,
  listTrash,
  readTrashedAsset,
} from "@/persistence/trash";
import { useProjectStore } from "@/stores/project-store";
import type { ID } from "@movie-desk/core";

// Removed media for this project. Restore puts the record back in the
// library (its file was kept); delete-for-good lets the next GC reap it.

export function TrashDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const projectId = useProjectStore((s) => s.project.id);
  const addMediaAsset = useProjectStore((s) => s.addMediaAsset);
  const [rows, setRows] = useState<readonly TrashEntry[]>([]);

  const refresh = useCallback(async () => {
    setRows(await listTrash(projectId));
  }, [projectId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const restore = async (row: TrashEntry) => {
    const asset = await readTrashedAsset(row.id);
    await deleteTrashEntry(row.id);
    if (!asset) {
      toast.error(t("media.trashDamaged", { name: row.name }));
    } else if (useProjectStore.getState().project.mediaLibrary.some((a) => a.id === asset.id)) {
      toast.info(t("media.trashAlreadyPresent", { name: row.name }));
    } else {
      addMediaAsset(asset);
      toast.success(t("media.trashRestored", { name: asset.name }));
    }
    await refresh();
    onChanged();
  };

  const remove = async (row: TrashEntry) => {
    await deleteTrashEntry(row.id);
    await refresh();
    onChanged();
  };

  const clear = async () => {
    await emptyTrash(projectId as ID);
    await refresh();
    onChanged();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[440px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-white/10 bg-panel-1 p-5 shadow-2xl"
          data-trash-dialog
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-medium text-ink-1">
              {t("media.trashTitle")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-ghost p-1" aria-label={t("export.cancel")}>
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-meta text-ink-3">
            {t("media.trashHint")}
          </Dialog.Description>

          {rows.length === 0 ? (
            <p className="mt-4 text-meta text-ink-3">{t("media.trashEmpty")}</p>
          ) : (
            <ul className="mt-4 space-y-1.5">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-2 rounded-md border border-white/5 bg-panel-2 px-3 py-2 text-meta"
                  data-trash-row={row.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink-1">{row.name}</div>
                    <div className="text-ink-3">
                      {row.kind} · {new Date(row.deletedAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    onClick={() => void restore(row)}
                    title={t("media.trashRestore")}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    {t("media.trashRestore")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 text-red-300"
                    onClick={() => void remove(row)}
                    title={t("media.trashDeleteForever")}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 flex justify-end gap-2">
            {rows.length > 0 && (
              <button type="button" className="btn-ghost text-red-300" onClick={() => void clear()}>
                {t("media.trashEmptyAll")}
              </button>
            )}
            <Dialog.Close asChild>
              <button type="button" className="btn-primary">
                {t("export.close")}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
