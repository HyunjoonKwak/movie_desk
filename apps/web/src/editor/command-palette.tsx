"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { useEditorStore as useProjectStore } from "@/stores/editor-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useT } from "@/i18n/use-t";

interface Action {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

// Cmd/Ctrl+K command palette. Actions operate on the current selection /
// playhead via the stores at call time. (The `?` shortcut cheatsheet lives
// in shortcut-cheatsheet.tsx, toggled via the view store.)
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else setQuery("");
  }, [open]);

  const actions: Action[] = useMemo(() => {
    const ps = useProjectStore.getState;
    const sel = () => [...useSelectionStore.getState().clipIds][0];
    return [
      { id: "play", label: t("cmd.playPause"), hint: "Space", run: () => usePlaybackStore.getState().toggle() },
      { id: "undo", label: t("cmd.undo"), hint: "Cmd+Z", run: () => ps().undo() },
      { id: "redo", label: t("cmd.redo"), hint: "Shift+Cmd+Z", run: () => ps().redo() },
      {
        id: "split",
        label: t("cmd.split"),
        hint: "S",
        run: () => {
          const id = sel();
          if (id) ps().splitAt(id, ps().project.timeline.playhead);
        },
      },
      {
        id: "delete",
        label: t("cmd.deleteClip"),
        hint: "Del",
        run: () => {
          const id = sel();
          if (id) ps().removeClipById(id);
        },
      },
      {
        id: "bladeAll",
        label: t("cmd.blade"),
        hint: "Cmd+B",
        run: () => ps().splitAllAt(ps().project.timeline.playhead),
      },
      {
        id: "marker",
        label: t("cmd.addMarker"),
        hint: "M",
        run: () => ps().addMarkerAt(ps().project.timeline.playhead),
      },
      { id: "addV", label: t("cmd.addVideoTrack"), run: () => ps().addNewTrack("video") },
      { id: "addA", label: t("cmd.addAudioTrack"), run: () => ps().addNewTrack("audio") },
      { id: "addText", label: t("cmd.addText"), run: () => ps().addTextClipAtPlayhead("Title") },
      { id: "goStart", label: t("cmd.goToStart"), run: () => ps().setPlayheadMs(0) },
    ];
  }, [t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions;
  }, [actions, query]);

  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/4 z-50 w-[460px] -translate-x-1/2 overflow-hidden rounded-lg border border-white/10 bg-panel-1 shadow-2xl">
            <Dialog.Title className="sr-only">{t("cmd.palette")}</Dialog.Title>
            <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
              <Search className="size-4 text-ink-3" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("cmd.searchPlaceholder")}
                className="flex-1 bg-transparent text-sm text-ink-1 outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filtered[0]) {
                    filtered[0].run();
                    setOpen(false);
                  }
                }}
              />
              <kbd className="rounded bg-white/5 px-1.5 py-0.5 text-3xs text-ink-3">esc</kbd>
            </div>
            <ul className="max-h-72 overflow-y-auto p-1">
              {filtered.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      a.run();
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm text-ink-1 hover:bg-white/10"
                  >
                    {a.label}
                    {a.hint && (
                      <kbd className="rounded bg-white/5 px-1.5 py-0.5 text-3xs text-ink-3">
                        {a.hint}
                      </kbd>
                    )}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-ink-3">{t("cmd.noResults")}</li>
              )}
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

