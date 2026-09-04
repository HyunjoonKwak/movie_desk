"use client";

import { useState } from "react";
import {
  Activity,
  Clapperboard,
  FileText,
  MapPin,
  Music2,
  ShieldCheck,
  Sliders,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AutoEditPanel } from "@/autoedit/components/autoedit-panel";
import { InspectorPanel } from "./inspector-panel";
import { SubtitlePanel } from "@/subtitles/subtitle-panel";
import { ScopesPanel } from "@/preview/scopes-panel";
import { MulticamPanel } from "./multicam-panel";
import { MarkerPanel } from "./marker-panel";
import { MusicPanel } from "@/music/components/music-panel";
import { ProjectInspectorPanel } from "./project-inspector-panel";
import { useT } from "@/i18n/use-t";

export type RightPanelTab =
  | "inspector"
  | "auto"
  | "subs"
  | "music"
  | "scopes"
  | "multicam"
  | "markers"
  | "inspect";

export function RightPanel({ initialTab = "inspector" }: { initialTab?: RightPanelTab }) {
  const [tab, setTab] = useState<RightPanelTab>(initialTab);
  const t = useT();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 overflow-hidden border-b border-line bg-panel-1 px-1 pt-1">
        <TabButton
          active={tab === "inspector"}
          onClick={() => setTab("inspector")}
          icon={<Sliders className="size-3.5" />}
          label={t("inspector.title")}
        />
        <TabButton
          active={tab === "auto"}
          onClick={() => setTab("auto")}
          icon={<Wand2 className="size-3.5" />}
          label={t("auto.tab")}
        />
        <TabButton
          active={tab === "subs"}
          onClick={() => setTab("subs")}
          icon={<FileText className="size-3.5" />}
          label={t("subs.tab")}
        />
        <TabButton
          active={tab === "music"}
          onClick={() => setTab("music")}
          icon={<Music2 className="size-3.5" />}
          label={t("music.tab")}
        />
        <TabButton
          active={tab === "scopes"}
          onClick={() => setTab("scopes")}
          icon={<Activity className="size-3.5" />}
          label={t("scopes.tab")}
        />
        <TabButton
          active={tab === "multicam"}
          onClick={() => setTab("multicam")}
          icon={<Clapperboard className="size-3.5" />}
          label={t("multicam.tab")}
        />
        <TabButton
          active={tab === "markers"}
          onClick={() => setTab("markers")}
          icon={<MapPin className="size-3.5" />}
          label={t("marker.tab")}
        />
        <TabButton
          active={tab === "inspect"}
          onClick={() => setTab("inspect")}
          icon={<ShieldCheck className="size-3.5" />}
          label={t("inspect.tab")}
        />
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === "inspector" && <InspectorPanel />}
        {tab === "auto" && <AutoEditPanel />}
        {tab === "subs" && <SubtitlePanel />}
        {tab === "music" && <MusicPanel />}
        {tab === "scopes" && <ScopesPanel />}
        {tab === "multicam" && <MulticamPanel />}
        {tab === "markers" && <MarkerPanel />}
        {tab === "inspect" && <ProjectInspectorPanel />}
      </div>
    </div>
  );
}

// Stable icon-only tabs keep all tools in a predictable position. Labels live
// in native tooltips and aria-labels; the active tool gets a filled surface.
function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "relative flex min-w-0 flex-1 items-center justify-center rounded-t-md border border-transparent px-2 text-2xs transition-colors",
        active
          ? "border-line-strong bg-panel-2 text-accent"
          : "text-ink-3 hover:bg-panel-3 hover:text-ink-1",
      )}
    >
      {icon}
      {active && <span className="absolute inset-x-2 bottom-0 h-px bg-accent" />}
    </button>
  );
}
