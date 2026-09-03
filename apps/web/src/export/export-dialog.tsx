"use client";

import type { MessageKey } from "@/i18n/messages";
import { useT } from "@/i18n/use-t";
import { useProjectStore } from "@/stores/project-store";
import { useRangeStore } from "@/stores/range-store";
import * as Dialog from "@radix-ui/react-dialog";
import { Activity, CheckCircle2, Download, FolderOpen, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ProjectAudioMixer } from "./audio-mixer";
import { useDuckingStore } from "./ducking-store";
import {
  ExportCancelledError,
  type ExportDestination,
  WebCodecsExporter,
  downloadBlob,
  revealExport,
} from "./exporter";
import { MissingMediaError } from "./preflight";
import { LoudnessMeter, type LoudnessResult } from "./loudness";
import { useNormalizeStore } from "./normalize-store";
import { PRESETS, estimateExportSizeMb } from "./presets";
import type { ExportProgress } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STAGE_KEY: Record<ExportProgress["stage"], MessageKey> = {
  preparing: "export.preparing",
  rendering: "export.rendering",
  muxing: "export.muxing",
  finalizing: "export.finalizing",
};

const formatEta = (seconds: number): string => {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}m ${s}s`;
};

const formatSize = (megabytes: number): string => {
  if (megabytes <= 0) return "0 MB";
  if (megabytes >= 1000) return `${(megabytes / 1000).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(megabytes))} MB`;
};

interface ExportedFile {
  readonly name: string;
  readonly preset: string;
  readonly destination: ExportDestination;
}

// The folder part of a saved path, for the completion screen.
const folderOf = (path: string): string => {
  const cut = path.lastIndexOf("/");
  if (cut < 0) return path;
  return cut === 0 ? "/" : path.slice(0, cut);
};

export function ExportDialog({ open, onOpenChange }: Props) {
  const projectId = useProjectStore((s) => s.project.id);
  const projectName = useProjectStore((s) => s.project.name);
  const projectDuration = useProjectStore((s) => s.project.timeline.duration);
  const rangeIn = useRangeStore((s) => s.inMs);
  const rangeOut = useRangeStore((s) => s.outMs);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set([PRESETS[0]!.id]));
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [queueLabel, setQueueLabel] = useState("");
  const [running, setRunning] = useState(false);
  // What the last run produced; shown in place of the presets until the
  // user closes or chooses to export again.
  const [completed, setCompleted] = useState<readonly ExportedFile[] | null>(null);
  const [missingNames, setMissingNames] = useState<readonly string[] | null>(null);
  // The dialog stays mounted while closed; a reopen starts from the presets.
  useEffect(() => {
    if (open) return;
    setCompleted(null);
    setMissingNames(null);
  }, [open]);
  const [loudness, setLoudness] = useState<LoudnessResult | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const duckEnabled = useDuckingStore((s) => s.enabled);
  const setDuckEnabled = useDuckingStore((s) => s.setEnabled);
  const normEnabled = useNormalizeStore((s) => s.enabled);
  const setNormEnabled = useNormalizeStore((s) => s.setEnabled);
  const targetLufs = useNormalizeStore((s) => s.targetLufs);
  const setTargetLufs = useNormalizeStore((s) => s.setTargetLufs);

  const togglePreset = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exporterRef = useRef<WebCodecsExporter | null>(null);
  const t = useT();
  const exportDuration = Math.max(0, (rangeOut ?? projectDuration) - (rangeIn ?? 0));
  const presetName = (id: string) => t(`export.preset.${id}.name`);

  const handleExport = async () => {
    const queue = PRESETS.filter((p) => selectedIds.has(p.id));
    if (queue.length === 0) return;
    setRunning(true);
    setMissingNames(null);
    const files: ExportedFile[] = [];
    try {
      for (let i = 0; i < queue.length; i++) {
        const preset = queue[i]!;
        const label = presetName(preset.id);
        setQueueLabel(queue.length > 1 ? `${label} (${i + 1}/${queue.length})` : label);
        setProgress({ stage: "preparing", progress: 0 });
        const exporter = new WebCodecsExporter();
        exporterRef.current = exporter;
        const result = await exporter.start({ projectId, preset }, setProgress);
        const destination = await downloadBlob(result.blob, result.suggestedName);
        files.push({ name: result.suggestedName, preset: label, destination });
        if (destination.kind !== "cancelled") {
          toast.success(t("export.success", { name: result.suggestedName }));
        }
        exporterRef.current = null;
      }
    } catch (err) {
      if (err instanceof ExportCancelledError) {
        toast.info(t("export.cancelled"));
      } else if (err instanceof MissingMediaError) {
        const names = err.missing.map((m) => m.name);
        setMissingNames(names);
        toast.error(t("export.missingMedia", { names: names.join(", ") }));
      } else {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error(t("export.failed", { msg }));
      }
    } finally {
      // Files written before a later preset failed are still shown.
      if (files.length > 0) setCompleted(files);
      setRunning(false);
      setProgress(null);
      setQueueLabel("");
      exporterRef.current = null;
    }
  };

  const handleCancel = () => {
    exporterRef.current?.cancel();
  };

  const handleMeasure = async () => {
    setMeasuring(true);
    setLoudness(null);
    try {
      const project = useProjectStore.getState().project;
      const assets = new Map(project.mediaLibrary.map((a) => [a.id, a]));
      const duck = useDuckingStore.getState();
      const mixer = new ProjectAudioMixer(project, (id) => assets.get(id), {
        enabled: duck.enabled,
        amountDb: duck.amountDb,
        thresholdDb: duck.thresholdDb,
      });
      try {
        const meter = new LoudnessMeter(mixer.sampleRate, 2);
        for await (const chunk of mixer.chunks()) meter.push(chunk.channels);
        const result = meter.result();
        if (!Number.isFinite(result.integratedLufs) && !Number.isFinite(result.peakDbfs)) {
          toast.error(t("loudness.noAudio"));
          return;
        }
        setLoudness(result);
      } finally {
        mixer.dispose();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(t("export.failed", { msg }));
    } finally {
      setMeasuring(false);
    }
  };

  const fmtLufs = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} LUFS` : "—");
  const fmtPeak = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} dBFS` : "—");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[440px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-white/10 bg-panel-1 p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-medium text-ink-1">
              {t("export.title", { name: projectName })}
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

          {missingNames && (
            <div className="mt-4 rounded-md border border-red-400/30 bg-red-400/10 p-3 text-meta text-ink-1">
              <div className="font-medium">{t("export.missingTitle")}</div>
              <div className="mt-1 break-words text-ink-2">{missingNames.join(", ")}</div>
              <div className="mt-2 text-ink-2">{t("export.missingHint")}</div>
            </div>
          )}

          {completed ? (
            <div className="mt-4 space-y-3" data-export-complete>
              <div className="flex items-center gap-2 text-sm font-medium text-ink-1">
                <CheckCircle2 className="size-4 text-emerald-400" aria-hidden />
                {t("export.doneTitle")}
              </div>
              <ul className="space-y-2">
                {completed.map((file) => (
                  <li
                    key={`${file.preset}-${file.name}`}
                    className="rounded-md border border-white/5 bg-panel-2 px-3 py-2 text-meta"
                  >
                    <div className="font-medium text-ink-1">{file.name}</div>
                    <div className="text-ink-3">{file.preset}</div>
                    {file.destination.kind === "file" && (
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate text-ink-2" title={file.destination.path}>
                          {folderOf(file.destination.path)}
                        </span>
                        <button
                          type="button"
                          className="btn-ghost shrink-0"
                          onClick={() => {
                            if (file.destination.kind !== "file") return;
                            void revealExport(file.destination.path).then((shown) => {
                              if (!shown) toast.error(t("export.revealFailed"));
                            });
                          }}
                        >
                          <FolderOpen className="size-3.5" aria-hidden />
                          {t("export.reveal")}
                        </button>
                      </div>
                    )}
                    {file.destination.kind === "download" && (
                      <div className="mt-1 text-ink-2">{t("export.doneDownloads")}</div>
                    )}
                    {file.destination.kind === "cancelled" && (
                      <div className="mt-1 text-ink-2">{t("export.doneSaveCancelled")}</div>
                    )}
                  </li>
                ))}
              </ul>
              <div className="text-meta text-ink-3">{t("export.doneShareHint")}</div>
            </div>
          ) : (
            <>
              <div className="mt-4 space-y-3">
                <div className="block text-2xs uppercase tracking-wider text-ink-3">
                  {t("export.preset")} ({selectedIds.size})
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {PRESETS.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-white/5 bg-panel-2 px-3 py-2 text-sm hover:border-accent has-[input:checked]:border-accent"
                    >
                      <span>
                        <span className="flex items-center gap-1.5 font-medium text-ink-1">
                          {presetName(p.id)}
                          {p.id === "family-720p" && (
                            <span className="rounded bg-accent/20 px-1.5 py-0.5 text-3xs text-accent">
                              {t("export.recommended")}
                            </span>
                          )}
                        </span>
                        <span className="block text-meta text-ink-2">
                          {t(`export.preset.${p.id}.description`)}
                        </span>
                        <span className="block text-meta text-ink-3">
                          {p.width}×{p.height} • {p.fps} fps • {p.videoCodec}/{p.audioCodec} •{" "}
                          {p.videoBitrateKbps} kbps
                        </span>
                        <span className="block text-meta text-ink-3">
                          {t("export.sizeEstimate", {
                            total: formatSize(estimateExportSizeMb(p, exportDuration)),
                            perMinute: formatSize(estimateExportSizeMb(p, 60_000)),
                          })}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        value={p.id}
                        checked={selectedIds.has(p.id)}
                        onChange={() => togglePreset(p.id)}
                        className="accent-accent"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <label className="mt-3 flex items-center gap-2 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={duckEnabled}
                  onChange={(e) => setDuckEnabled(e.target.checked)}
                  className="accent-accent"
                />
                {t("export.ducking")}
              </label>

              <div className="mt-2 flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    checked={normEnabled}
                    onChange={(e) => setNormEnabled(e.target.checked)}
                    className="accent-accent"
                  />
                  {t("normalize.label")}
                </label>
                <select
                  value={targetLufs}
                  onChange={(e) => setTargetLufs(Number(e.target.value))}
                  disabled={!normEnabled}
                  className="rounded bg-white/5 px-2 py-1 text-meta text-ink-1 outline-none disabled:opacity-40"
                >
                  <option value={-14} className="bg-panel-2">
                    -14 LUFS (web)
                  </option>
                  <option value={-16} className="bg-panel-2">
                    -16 LUFS
                  </option>
                  <option value={-23} className="bg-panel-2">
                    -23 LUFS (broadcast)
                  </option>
                </select>
              </div>

              <div className="mt-3 rounded-md border border-white/5 bg-panel-2 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-2">{t("loudness.title")}</span>
                  <button
                    type="button"
                    onClick={handleMeasure}
                    disabled={measuring}
                    className="flex items-center gap-1 rounded px-2 py-0.5 text-meta text-ink-3 hover:bg-white/10 hover:text-ink-1 disabled:opacity-50"
                  >
                    {measuring ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Activity className="size-3" />
                    )}
                    {measuring ? t("loudness.measuring") : t("loudness.measure")}
                  </button>
                </div>
                {loudness && (
                  <div className="mt-1.5 flex justify-between text-meta">
                    <span className="text-ink-3">
                      {t("loudness.integrated")}:{" "}
                      <span className="font-mono text-ink-1">
                        {fmtLufs(loudness.integratedLufs)}
                      </span>
                    </span>
                    <span className="text-ink-3">
                      {t("loudness.peak")}:{" "}
                      <span className="font-mono text-ink-1">{fmtPeak(loudness.peakDbfs)}</span>
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {progress && (
            <div className="mt-4 space-y-1">
              {queueLabel && <div className="text-meta font-medium text-ink-2">{queueLabel}</div>}
              <div className="flex justify-between text-meta text-ink-3">
                <span>{t(STAGE_KEY[progress.stage])}</span>
                <span>
                  {Math.round(progress.progress * 100)}%
                  {progress.fps !== undefined && progress.progress > 0 && progress.progress < 1 && (
                    <span className="ml-2 font-mono">{progress.fps.toFixed(1)} fps</span>
                  )}
                  {progress.etaSeconds !== undefined && progress.etaSeconds > 1 && (
                    <span className="ml-2 font-mono">ETA {formatEta(progress.etaSeconds)}</span>
                  )}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-white/5">
                <div
                  className="h-full bg-accent transition-[width] duration-150"
                  style={{ width: `${Math.round(progress.progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            {completed ? (
              <>
                <button type="button" className="btn-ghost" onClick={() => setCompleted(null)}>
                  {t("export.again")}
                </button>
                <Dialog.Close asChild>
                  <button type="button" className="btn-primary">
                    {t("export.close")}
                  </button>
                </Dialog.Close>
              </>
            ) : (
              <>
                {running ? (
                  <button type="button" className="btn-ghost" onClick={handleCancel}>
                    {t("export.cancel")}
                  </button>
                ) : (
                  <Dialog.Close asChild>
                    <button type="button" className="btn-ghost">
                      {t("export.cancel")}
                    </button>
                  </Dialog.Close>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleExport}
                  disabled={running}
                >
                  {running ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {running ? t("export.exporting") : t("export.export")}
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
