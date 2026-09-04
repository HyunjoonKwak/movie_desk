"use client";

import { collectDroppedMediaFiles, type MediaImportCandidate } from "@/media/folder-import";
import { useMediaImport } from "@/media/hooks";
import { useT } from "@/i18n/use-t";
import {
  ArrowRight,
  Clapperboard,
  FolderOpen,
  FolderUp,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useRef } from "react";
import { toast } from "sonner";

export type NewProjectPath = "organize" | "manual" | "guided";

export function NewProjectStart({ onChoose }: { onChoose: (path: NewProjectPath) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { importing, importFiles } = useMediaImport();
  const t = useT();

  const importThenOpen = useCallback(
    async (files: FileList | readonly File[] | readonly MediaImportCandidate[]) => {
      if (files.length === 0) return;
      try {
        await importFiles(files);
      } finally {
        // Failed files remain visible in the existing Media panel, where the
        // established retry and error explanations are available.
        onChoose("organize");
      }
    },
    [importFiles, onChoose],
  );

  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const collected = await collectDroppedMediaFiles(event.dataTransfer);
      if (collected.unreadablePaths.length > 0) {
        toast.warning(t("media.folderUnreadable", { n: collected.unreadablePaths.length }));
      }
      if (collected.candidates.length > 0) await importThenOpen(collected.candidates);
    },
    [importThenOpen, t],
  );

  return (
    <main
      className="relative min-h-0 flex-1 overflow-y-auto bg-panel-0"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      data-testid="new-project-start"
      aria-labelledby="new-project-start-title"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute left-[-8rem] top-[-10rem] size-[30rem] rounded-full bg-accent/[0.055] blur-3xl" />
        <div className="absolute bottom-[-16rem] right-[-12rem] size-[34rem] rounded-full bg-focus/[0.045] blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col justify-center px-5 py-8 sm:px-8 lg:px-12">
        <div className="max-w-2xl">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            <Clapperboard className="size-4" />
            {t("start.eyebrow")}
          </p>
          <h1
            id="new-project-start-title"
            className="text-balance text-3xl font-semibold tracking-[-0.035em] text-ink-1 sm:text-4xl"
          >
            {t("start.title")}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-ink-2 sm:text-[15px]">
            {t("start.description")}
          </p>
        </div>

        <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
          <section className="flex min-h-56 flex-col rounded-xl border border-accent/40 bg-accent/[0.07] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.18)] transition-colors hover:border-accent/65 hover:bg-accent/[0.09]">
            <div className="flex items-start justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
                <FolderUp className="size-5" />
              </span>
              <span className="rounded-full border border-accent/25 bg-accent/10 px-2 py-1 text-3xs font-semibold text-accent">
                {t("start.organize.badge")}
              </span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-ink-1">{t("start.organize.title")}</h2>
            <p className="mt-2 flex-1 break-keep text-xs leading-5 text-ink-2">
              {t("start.organize.description")}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary flex-1 px-3"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                <FolderUp className="size-3.5" />
                {importing ? t("start.importing") : t("start.organize.files")}
              </button>
              <button
                type="button"
                className="btn-ghost border border-line-strong px-3"
                onClick={() => folderInputRef.current?.click()}
                disabled={importing}
                aria-label={t("start.organize.folder")}
                title={t("start.organize.folder")}
              >
                <FolderOpen className="size-3.5" />
                <span className="md:sr-only xl:not-sr-only">{t("start.organize.folder")}</span>
              </button>
            </div>
          </section>

          <StartOption
            icon={<Clapperboard className="size-5" />}
            title={t("start.manual.title")}
            description={t("start.manual.description")}
            detail={t("start.manual.detail")}
            action={t("start.manual.action")}
            onClick={() => onChoose("manual")}
          />

          <StartOption
            icon={<Sparkles className="size-5" />}
            title={t("start.guided.title")}
            description={t("start.guided.description")}
            detail={t("start.guided.detail")}
            action={t("start.guided.action")}
            onClick={() => onChoose("guided")}
          />
        </div>

        <div className="mt-6 flex flex-col gap-2 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 shrink-0 text-ok" />
            {t("start.local")}
          </p>
          <p>{t("start.switchLater")}</p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void importThenOpen(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={(element) => {
          folderInputRef.current = element;
          element?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        accept="video/*,audio/*,image/*,.heic,.heif"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void importThenOpen(event.target.files);
          event.target.value = "";
        }}
      />
    </main>
  );
}

function StartOption({
  icon,
  title,
  description,
  detail,
  action,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  detail: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <section className="flex min-h-56 flex-col rounded-xl border border-line bg-panel-1 p-5 shadow-[0_18px_55px_rgba(0,0,0,0.14)] transition-colors hover:border-line-strong hover:bg-panel-2/80">
      <span className="flex size-10 items-center justify-center rounded-lg border border-line-strong bg-panel-2 text-ink-2">
        {icon}
      </span>
      <h2 className="mt-4 text-lg font-semibold text-ink-1">{title}</h2>
      <p className="mt-2 break-keep text-xs leading-5 text-ink-2">{description}</p>
      <p className="mt-2 flex-1 break-keep text-2xs leading-4 text-ink-3">{detail}</p>
      <button
        type="button"
        className="btn-ghost mt-5 w-full justify-between border border-line-strong px-3"
        onClick={onClick}
      >
        {action}
        <ArrowRight className="size-3.5" />
      </button>
    </section>
  );
}
