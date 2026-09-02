"use client";

import { useMemo, useRef } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { isTextClip, formatTimecode } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import { useT } from "@/i18n/use-t";
import { parseSrt, parseVtt, toSrt, toVtt, type SubtitleCue } from "./srt";
import {
  listSubtitleClips,
  replaceSubtitlesFromCues,
  subtitleClipsToCues,
} from "./subtitle-utils";

const trigger = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function SubtitlePanel() {
  const project = useProjectStore((s) => s.project);
  const updateTextClip = useProjectStore((s) => s.updateTextClip);
  const removeClip = useProjectStore((s) => s.removeClipById);
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const fps = project.framerate;

  const clips = useMemo(() => listSubtitleClips(project), [project]);

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const cues: readonly SubtitleCue[] = file.name.toLowerCase().endsWith(".vtt")
        ? parseVtt(text)
        : parseSrt(text);
      if (cues.length === 0) {
        toast.error(t("subs.importEmpty"));
        return;
      }
      const next = replaceSubtitlesFromCues(useProjectStore.getState().project, cues);
      useProjectStore.setState({ project: next });
      toast.success(t("subs.imported", { n: cues.length }));
    } catch (err) {
      toast.error(`${t("subs.importFailed")}: ${err instanceof Error ? err.message : err}`);
    }
  };

  const onExportSrt = () => {
    const cues = subtitleClipsToCues(useProjectStore.getState().project);
    if (cues.length === 0) {
      toast.error(t("subs.exportEmpty"));
      return;
    }
    trigger(new Blob([toSrt(cues)], { type: "application/x-subrip" }), `${project.name}.srt`);
  };

  const onExportVtt = () => {
    const cues = subtitleClipsToCues(useProjectStore.getState().project);
    if (cues.length === 0) {
      toast.error(t("subs.exportEmpty"));
      return;
    }
    trigger(new Blob([toVtt(cues)], { type: "text/vtt" }), `${project.name}.vtt`);
  };

  // Burn-in styling: bulk-apply one of the text style presets (defined in
  // text-section.tsx via the `text.preset.*` i18n keys) to every subtitle
  // clip so the export bakes the chosen look into the video. Subtitles are
  // already rendered as text clips on a dedicated track, so the compositor
  // burns them in on export by default — this just standardises the look.
  const applyBurnInStyle = (key: "clean" | "outline" | "pop" | "shadow") => {
    const presets: Record<typeof key, Parameters<typeof updateTextClip>[1]> = {
      clean:   { color: "#ffffff", strokeColor: "#000000", strokeWidth: 0, shadow: true, weight: 600 },
      outline: { color: "#ffffff", strokeColor: "#000000", strokeWidth: 6, shadow: false, weight: 700 },
      pop:     { color: "#ffe000", strokeColor: "#000000", strokeWidth: 5, shadow: true, weight: 800 },
      shadow:  { color: "#ffffff", strokeColor: "#000000", strokeWidth: 0, shadow: true, shadowBlur: 16, weight: 600 },
    };
    const patch = presets[key];
    const subs = listSubtitleClips(useProjectStore.getState().project);
    for (const c of subs) updateTextClip(c.id, patch);
    toast.success(t("subs.styleApplied", { n: subs.length, style: key }));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="panel-header">
        <span className="flex items-center gap-2">
          <FileText className="size-3.5" />
          {t("subs.title")}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost px-1.5 py-0.5 text-2xs"
            onClick={() => inputRef.current?.click()}
            title={t("subs.import")}
          >
            <Upload className="size-3" />
            SRT
          </button>
          <button
            type="button"
            className="btn-ghost px-1.5 py-0.5 text-2xs"
            onClick={onExportSrt}
            title={t("subs.exportSrt")}
          >
            <Download className="size-3" />
            SRT
          </button>
          <button
            type="button"
            className="btn-ghost px-1.5 py-0.5 text-2xs"
            onClick={onExportVtt}
            title={t("subs.exportVtt")}
          >
            <Download className="size-3" />
            VTT
          </button>
          <select
            className="btn-ghost px-1.5 py-0.5 text-2xs"
            title={t("subs.burnInTitle")}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === "clean" || v === "outline" || v === "pop" || v === "shadow") {
                applyBurnInStyle(v);
                e.currentTarget.value = "";
              }
            }}
          >
            <option value="" disabled>{t("subs.burnInTitle")}</option>
            <option value="clean">{t("text.preset.clean")}</option>
            <option value="outline">{t("text.preset.outline")}</option>
            <option value="pop">{t("text.preset.pop")}</option>
            <option value="shadow">{t("text.preset.shadow")}</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {clips.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-ink-3">{t("subs.empty")}</p>
        ) : (
          <ul className="space-y-1">
            {clips.map((c) => {
              if (!isTextClip(c)) return null;
              return (
                <li
                  key={c.id}
                  className="group rounded-md border border-white/5 bg-panel-2 p-2 text-xs"
                >
                  <div className="mb-1 flex items-center justify-between font-mono text-3xs text-ink-3">
                    <span>
                      {formatTimecode(c.start, fps)} → {formatTimecode(c.start + c.duration, fps)}
                    </span>
                    <button
                      type="button"
                      className="rounded p-0.5 opacity-0 hover:bg-red-500/20 hover:text-red-300 group-hover:opacity-100"
                      onClick={() => removeClip(c.id)}
                      title={t("subs.delete")}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={c.text}
                    onChange={(e) => updateTextClip(c.id, { text: e.target.value })}
                    className="w-full resize-none rounded bg-transparent text-ink-1 outline-none focus:bg-white/5"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".srt,.vtt,text/plain"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onImport(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
