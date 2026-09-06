"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import { StateHint } from "@/components/state-hint";
import { useT } from "@/i18n/use-t";
import { clearFunnelLog, readFunnelRows, type FunnelRow } from "@/persistence/funnel-log";
import { useProjectStore } from "@/stores/project-store";
import { computeFunnel } from "./compute";
import {
  funnelEnabled,
  measurementProjectId,
  setFunnelEnabled,
  settleFunnelCollection,
} from "./collector";

export function FunnelControls() {
  const t = useT();
  const [enabled, setEnabled] = useState(funnelEnabled);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(false);
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [currentId, setCurrentId] = useState("");
  const report = useMemo(() => computeFunnel(rows), [rows]);
  const current = report.projects.find((project) => project.projectId === currentId);
  const refresh = async () => {
    await settleFunnelCollection();
    setRows(await readFunnelRows());
    try {
      setCurrentId(await measurementProjectId(useProjectStore.getState().project.id));
    } catch {
      setCurrentId("");
    }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify({ version: 1, rows }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "movie-desk-funnel.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const clear = async () => {
    const wasEnabled = funnelEnabled();
    setFunnelEnabled(false);
    const success = await clearFunnelLog();
    setFunnelEnabled(wasEnabled);
    setError(!success);
    setConfirm(false);
    await refresh();
  };
  return (
    <div className="mt-4 border-t border-white/10 pt-3 text-xs">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setFunnelEnabled(event.target.checked);
            setEnabled(event.target.checked);
          }}
        />
        {t("funnel.toggle")}
      </label>
      <StateHint text={t("funnel.privacy")} />
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          setConfirm(false);
          if (value) void refresh();
          else setRows([]);
        }}
      >
        <Dialog.Trigger asChild>
          <button type="button" className="btn-ghost">
            {t("funnel.report")}
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] max-h-[90dvh] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-white/10 bg-panel-1 p-4 text-xs text-ink-1 shadow-2xl">
            <Dialog.Title className="text-base font-medium">{t("funnel.report")}</Dialog.Title>
            <Dialog.Description className="my-2 text-ink-3">
              {t("funnel.cohort")}
            </Dialog.Description>
            <p data-testid="funnel-rate" className="text-xl">
              {t("funnel.rate")}: {report.completed}/{report.imported} (
              {report.rate === null ? "—" : `${Math.round(report.rate * 100)}%`})
            </p>
            <p className="my-2">
              {t("funnel.projects")}: {report.total} · {t("funnel.baseline")}: {report.baseline} ·{" "}
              {t("funnel.incomplete")}: {report.incomplete}
            </p>
            <StateHint text={t("funnel.retention")} />
            <div className="overflow-x-auto">
              <table className="w-full text-left [&_th]:p-2 [&_td]:p-2">
                <thead>
                  <tr>
                    <th>{t("funnel.stage")}</th>
                    <th>{t("funnel.reached")}</th>
                    <th>{t("funnel.median")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.stages.map((stage) => (
                    <tr key={stage.event}>
                      <td>{t(`funnel.event.${stage.event}`)}</td>
                      <td>{stage.reached}</td>
                      <td>
                        {stage.medianMs === null ? "—" : `${(stage.medianMs / 1000).toFixed(1)} s`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="mt-4 font-medium">{t("funnel.recovery")}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left [&_th]:p-1 [&_td]:p-1">
                <thead>
                  <tr>
                    <th>{t("funnel.kind")}</th>
                    <th>{t("funnel.hint")}</th>
                    <th>{t("funnel.success")}</th>
                    <th>{t("funnel.abandoned")}</th>
                    <th>{t("funnel.pending")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.recoveries.map((row) => (
                    <tr key={`${row.kind}-${row.hintVisible}`}>
                      <td>{t(`funnel.kind.${row.kind}`)}</td>
                      <td>{t(row.hintVisible ? "funnel.yes" : "funnel.no")}</td>
                      <td>{row.success}</td>
                      <td>{row.abandoned}</td>
                      <td>{row.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="mt-4 font-medium">{t("funnel.timeline")}</h3>
            <p className="my-2">
              {t("funnel.event.undo")}: {current?.undo ?? 0} · {t("funnel.event.command")}:{" "}
              {current?.commands ?? 0}
            </p>
            <ol className="max-h-40 space-y-1 overflow-y-auto" data-testid="funnel-timeline">
              {current?.timeline
                .filter(
                  (row) =>
                    row.event !== "command" && row.event !== "undo" && row.event !== "activity",
                )
                .slice(-100)
                .map((row) => (
                  <li key={row.id}>
                    {new Date(row.at).toLocaleTimeString()} — {t(`funnel.event.${row.event}`)}
                    {"baseline" in row.data && row.data.baseline
                      ? ` (${t("funnel.baseline")})`
                      : ""}
                  </li>
                ))}
            </ol>
            {error && <StateHint tone="error" text={t("funnel.deleteFailed")} />}
            {confirm ? (
              <div className="mt-3">
                <p>{t("funnel.confirm")}</p>
                <button type="button" className="btn-ghost" onClick={() => void clear()}>
                  {t("funnel.deleteConfirm")}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>
                  {t("funnel.cancel")}
                </button>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-ghost" onClick={download}>
                {t("funnel.download")}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirm(true)}>
                {t("funnel.delete")}
              </button>
              <Dialog.Close asChild>
                <button type="button" className="btn-ghost">
                  {t("funnel.close")}
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
