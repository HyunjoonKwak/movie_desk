"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { History, RotateCcw, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useProjectStore } from "@/stores/project-store";
import { useT } from "@/i18n/use-t";
import {
  deleteSnapshot,
  cleanupSnapshots,
  snapshotCleanupCandidates,
  listSnapshots,
  loadSnapshot,
  saveSnapshot,
  type ProjectSnapshot,
} from "@/persistence/snapshots";

export function SnapshotMenu() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProjectSnapshot[]>([]);
  const [label, setLabel] = useState("");
  const project = useProjectStore((s) => s.project);
  const loadProject = useProjectStore((s) => s.loadProject);
  const t = useT();
  const candidates = snapshotCleanupCandidates(rows);

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const refresh = async () => setRows([...(await listSnapshots(project.id))]);

  const onSave = async () => {
    await saveSnapshot(useProjectStore.getState().project, label.trim());
    setLabel("");
    await refresh();
    toast.success(t("snap.saved"));
  };

  const onRestore = async (id: string) => {
    const snap = await loadSnapshot(id);
    if (snap) {
      loadProject(snap);
      setOpen(false);
      toast.success(t("snap.restored"));
    } else {
      toast.error(t("snap.corrupt"));
    }
  };

  const onDelete = async (id: string) => {
    await deleteSnapshot(id);
    await refresh();
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" title={t("snap.menu")}>
          <History className="size-3.5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/10 bg-panel-1 p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-medium text-ink-1">
              {t("snap.menu")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink-1">
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 flex gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("snap.labelPlaceholder")}
              className="flex-1 rounded bg-white/5 px-2 py-1.5 text-sm text-ink-1 outline-none focus:bg-white/10"
              onKeyDown={(e) => {
                if (e.key === "Enter") void onSave();
              }}
            />
            <button type="button" onClick={onSave} className="btn-primary text-xs">
              <Save className="size-3.5" />
              {t("snap.save")}
            </button>
          </div>

          {candidates.length > 0 && (
            <div className="mt-3 flex items-center justify-between text-xs text-ink-2">
              <span>{t("snap.cleanupAvailable", { n: candidates.length })}</span>
              <button
                type="button"
                className="btn-ghost"
                onClick={async () => {
                  if (!window.confirm(t("snap.cleanupConfirm", { n: candidates.length }))) return;
                  await cleanupSnapshots(
                    project.id,
                    candidates.map((row) => row.id),
                  );
                  await refresh();
                }}
              >
                {t("snap.cleanup")}
              </button>
            </div>
          )}
          <ul className="mt-4 max-h-72 space-y-1 overflow-y-auto">
            {rows.length === 0 && (
              <li className="px-2 py-6 text-center text-xs text-ink-3">{t("snap.empty")}</li>
            )}
            {rows.map((row) => (
              <li
                key={row.id}
                className="group flex items-center justify-between rounded-md border border-white/5 bg-panel-2 px-3 py-2"
              >
                <div className="flex-1">
                  <span className="block text-sm text-ink-1">{row.label}</span>
                  <span className="block text-3xs text-ink-3">
                    {new Date(row.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onRestore(row.id)}
                    className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-accent"
                    title={t("snap.restore")}
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(row.id)}
                    className="rounded p-1 text-ink-3 opacity-0 hover:bg-red-500/20 hover:text-red-300 group-hover:opacity-100"
                    title={t("snap.delete")}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
