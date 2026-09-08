"use client";

import { useProjectStore } from "@/stores/project-store";
import { useEditorStore, openTimeline } from "@/stores/editor-store";
import { useT } from "@/i18n/use-t";
import { TimelinePanel } from "./timeline-panel";

export function TimelineWorkspace() {
  const timelines = useProjectStore((state) => state.project.timelines);
  const rootId = useProjectStore((state) => state.project.rootTimelineId);
  const activeId = useEditorStore((state) => state.project.timeline.id);
  const t = useT();
  // Preserve the exact single-timeline DOM and layout.
  if (timelines.length <= 1) return <TimelinePanel timelineId={activeId} />;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div role="tablist" aria-label={t("timeline.tabs")} className="flex shrink-0 overflow-x-auto border-b border-white/10 bg-panel-2">
        {timelines.map((timeline, index) => (
          <button
            key={timeline.id}
            type="button"
            role="tab"
            id={`timeline-tab-${timeline.id}`}
            aria-controls={`timeline-panel-${timeline.id}`}
            aria-selected={timeline.id === activeId}
            tabIndex={timeline.id === activeId ? 0 : -1}
            onClick={() => openTimeline(timeline.id)}
            onKeyDown={(event) => {
              const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              const target = event.key === "Home" ? 0 : event.key === "End" ? timelines.length - 1 : offset ? (index + offset + timelines.length) % timelines.length : -1;
              if (target < 0) return;
              event.preventDefault();
              const next = timelines[target]!;
              openTimeline(next.id);
              document.getElementById(`timeline-tab-${next.id}`)?.focus();
            }}
            className={`max-w-52 shrink-0 truncate border-b-2 px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${timeline.id === activeId ? "border-accent text-white" : "border-transparent text-muted hover:text-white"}`}
          >
            {timeline.id === rootId ? t("timeline.root") : `${t("timeline.unnamed")} ${index}`}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`timeline-panel-${activeId}`} aria-labelledby={`timeline-tab-${activeId}`} className="min-h-0 flex-1">
        <TimelinePanel key={activeId} timelineId={activeId} />
      </div>
    </div>
  );
}
