"use client";

import * as Menu from "@radix-ui/react-context-menu";
import { Copy, Scissors, Trash2, ChevronsLeft, AlignHorizontalJustifyStart, EyeOff, Blend, AudioLines, Boxes, PackageOpen } from "lucide-react";
import type { ID } from "@movie-desk/core";
import { useEditorStore as useProjectStore } from "@/stores/editor-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useT } from "@/i18n/use-t";

interface Props {
  clipId: ID;
  children: React.ReactNode;
}

export function ClipContextMenu({ clipId, children }: Props) {
  const split = useProjectStore((s) => s.splitAt);
  const duplicate = useProjectStore((s) => s.duplicateClipById);
  const remove = useProjectStore((s) => s.removeClipById);
  const rippleDelete = useProjectStore((s) => s.rippleDeleteById);
  const closeGaps = useProjectStore((s) => s.closeGapsForClip);
  const toggleDisabled = useProjectStore((s) => s.toggleClipDisabledById);
  const crossfade = useProjectStore((s) => s.crossfadeWith);
  const detachAudio = useProjectStore((s) => s.detachAudioFrom);
  const select = useSelectionStore((s) => s.select);
  const makeCompound = useProjectStore((s) => s.makeCompound);
  const unpack = useProjectStore((s) => s.unpackCompound);
  // Only a compound offers unpacking, and combining needs something selected.
  const isCompound = useProjectStore((s) =>
    s.project.timeline.tracks.some((track) =>
      track.clips.some((clip) => clip.id === clipId && clip.kind === "sequence"),
    ),
  );
  const t = useT();

  return (
    <Menu.Root>
      <Menu.Trigger
        asChild
        onContextMenu={() => {
          // Right-clicking inside a multi-clip selection must keep it, or the
          // compound command would only ever see the clip under the cursor.
          if (!useSelectionStore.getState().clipIds.has(clipId)) select(clipId);
        }}
      >
        {children}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="z-50 min-w-[160px] rounded-md border border-white/10 bg-panel-3 p-1 text-xs shadow-xl">
          <Item
            onSelect={() => {
              const at = useProjectStore.getState().project.timeline.playhead;
              split(clipId, at);
            }}
            icon={<Scissors className="size-3" />}
          >
            {t("ctx.split")}
          </Item>
          <Item onSelect={() => duplicate(clipId)} icon={<Copy className="size-3" />}>
            {t("ctx.duplicate")}
          </Item>
          <Item onSelect={() => closeGaps(clipId)} icon={<AlignHorizontalJustifyStart className="size-3" />}>
            {t("ctx.closeGaps")}
          </Item>
          <Item onSelect={() => toggleDisabled(clipId)} icon={<EyeOff className="size-3" />}>
            {t("ctx.toggleEnable")}
          </Item>
          <Item onSelect={() => crossfade(clipId)} icon={<Blend className="size-3" />}>
            {t("ctx.crossfade")}
          </Item>
          <Item onSelect={() => detachAudio(clipId)} icon={<AudioLines className="size-3" />}>
            {t("ctx.detachAudio")}
          </Item>
          <Menu.Separator className="my-1 h-px bg-white/10" />
          {isCompound ? (
            <Item onSelect={() => unpack(clipId)} icon={<PackageOpen className="size-3" />}>
              {t("compound.unpack")}
            </Item>
          ) : (
            <Item onSelect={() => makeCompound()} icon={<Boxes className="size-3" />}>
              {t("compound.make")}
            </Item>
          )}
          <Menu.Separator className="my-1 h-px bg-white/10" />
          <Item onSelect={() => rippleDelete(clipId)} icon={<ChevronsLeft className="size-3" />}>
            {t("ctx.rippleDelete")}
          </Item>
          <Item
            danger
            onSelect={() => remove(clipId)}
            icon={<Trash2 className="size-3" />}
          >
            {t("ctx.delete")}
          </Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Item({
  onSelect,
  children,
  icon,
  danger,
}: {
  onSelect: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Menu.Item
      onSelect={onSelect}
      className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 outline-none ${
        danger ? "text-red-300 focus:bg-red-500/20" : "text-ink-1 focus:bg-white/10"
      }`}
    >
      {icon}
      {children}
    </Menu.Item>
  );
}
