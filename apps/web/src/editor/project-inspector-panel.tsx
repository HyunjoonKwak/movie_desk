"use client";

import { useMemo } from "react";
import { AlertTriangle, CircleAlert, Info, CheckCircle2 } from "lucide-react";
import { inspectProject, type IssueSeverity, type ID } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useT } from "@/i18n/use-t";

const ICONS: Record<IssueSeverity, typeof Info> = {
  error: CircleAlert,
  warning: AlertTriangle,
  info: Info,
};
const COLORS: Record<IssueSeverity, string> = {
  error: "text-red-400",
  warning: "text-amber-400",
  info: "text-ink-3",
};

// Static project health check: surfaces offline media, gaps, and likely audio
// clipping so issues are caught before export.
export function ProjectInspectorPanel() {
  const project = useProjectStore((s) => s.project);
  const select = useSelectionStore((s) => s.select);
  const t = useT();
  const issues = useMemo(() => inspectProject(project), [project]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/5 px-3 py-2 text-2xs uppercase tracking-wider text-ink-3">
        {t("inspect.title")} ({issues.length})
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {issues.length === 0 ? (
          <div className="flex items-center gap-2 px-1 text-2xs text-emerald-400">
            <CheckCircle2 className="size-3.5" />
            {t("inspect.clean")}
          </div>
        ) : (
          <ul className="space-y-1">
            {issues.map((issue) => {
              const Icon = ICONS[issue.severity];
              return (
                <li
                  key={`${issue.severity}:${issue.clipId ?? "global"}:${issue.message}`}
                  className={`flex items-start gap-2 rounded px-2 py-1.5 text-2xs ${
                    issue.clipId ? "cursor-pointer hover:bg-white/5" : ""
                  }`}
                  onClick={() => issue.clipId && select(issue.clipId as ID)}
                  onKeyDown={(e) => {
                    if (issue.clipId && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      select(issue.clipId as ID);
                    }
                  }}
                >
                  <Icon className={`mt-0.5 size-3.5 shrink-0 ${COLORS[issue.severity]}`} />
                  <span className="text-ink-1">{issue.message}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
