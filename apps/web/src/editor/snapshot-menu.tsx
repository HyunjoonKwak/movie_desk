"use client";

import { recordRecovery } from "@/lib/funnel/collector";
import { useEffect, useMemo, useState } from "react";
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
  const candidates = useMemo(() => snapshotCleanupCandidates(rows), [rows]);
  const [proposal, setProposal] = useState<{
    projectId: string;
    rows: readonly ProjectSnapshot[];
  } | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const confirmCleanup = async () => {
    if (!proposal || cleaning) return;
    setCleaning(true);
    try {
      await cleanupSnapshots(
        proposal.projectId,
        proposal.rows.map((row) => row.id),
      );
      await refresh();
      setProposal(null);
    } catch {
      toast.error(t("snap.cleanupFailed"));
    } finally {
      setCleaning(false);
    }
  };

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
    recordRecovery("snapshot", "pending", project.id);
    const snap = await loadSnapshot(id);
    if (snap) {
      recordRecovery("snapshot", "success", project.id);
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
              <button
                type="button"
                className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink-1"
              >
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
                onClick={() => setProposal({ projectId: project.id, rows: candidates })}
              >
                {t("snap.reviewCleanup")}
              </button>
            </div>
          )}
          <Dialog.Root
            open={proposal !== null}
            onOpenChange={(value) => {
              if (!value && !cleaning) setProposal(null);
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[420px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-panel-1 p-5 text-ink-1">
                <Dialog.Title>{t("snap.reviewCleanup")}</Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-ink-2">
                  {t("snap.cleanupConsequences")}
                </Dialog.Description>
                <ul className="my-3 max-h-56 overflow-auto text-sm">
                  {proposal?.rows.map((row) => (
                    <li key={row.id}>
                      {row.label} — {new Date(row.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={cleaning}
                    onClick={() => setProposal(null)}
                  >
                    {t("snap.cleanupCancel")}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={cleaning}
                    onClick={() => void confirmCleanup()}
                  >
                    {t("snap.deleteReviewed")}
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
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
