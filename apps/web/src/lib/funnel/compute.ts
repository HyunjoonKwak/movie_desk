import type { FunnelRow } from "@/persistence/funnel-log";

export const STAGES = ["start", "import", "clip", "export-start", "export-success"] as const;
export const RECOVERIES = ["relink", "snapshot", "save-conflict", "import-retry"] as const;
const median = (values: number[]): number | null => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[mid]! + sorted[Math.floor((sorted.length - 1) / 2)]!) / 2 : null;
};

export const computeFunnel = (input: readonly FunnelRow[]) => {
  const rows = [...input].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const grouped = new Map<string, FunnelRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.projectId) ?? [];
    group.push(row);
    grouped.set(row.projectId, group);
  }
  const projects = [...grouped].map(([projectId, timeline]) => {
    const start =
      timeline.find((row) => row.event === "start" && !row.data.baseline) ??
      timeline.find((row) => row.event === "start");
    const firstImport = timeline.find((row) => row.event === "import");
    const firstClip = timeline.find((row) => row.event === "clip");
    const baseline =
      (start?.event === "start" && start.data.baseline) ||
      (firstImport?.event === "import" && firstImport.data.baseline) ||
      (firstClip?.event === "clip" && firstClip.data.baseline);
    const times = STAGES.map(
      (stage) =>
        timeline.find(
          (row) =>
            row.event === stage &&
            (row.event !== "export-success" || (row.data.assets > 0 && row.data.clips > 0)),
        )?.at ?? null,
    );
    return {
      projectId,
      timeline,
      baseline,
      incomplete: !start,
      times,
      undo: timeline.reduce(
        (n, row) => n + (row.event === "activity" ? row.data.undos : row.event === "undo" ? 1 : 0),
        0,
      ),
      commands: timeline.reduce(
        (n, row) =>
          n + (row.event === "activity" ? row.data.commands : row.event === "command" ? 1 : 0),
        0,
      ),
    };
  });
  const eligible = projects.filter((p) => !p.baseline && !p.incomplete);
  const imported = eligible.filter((p) => p.times[1] !== null);
  const completed = imported.filter(
    (p) =>
      p.times[4] != null &&
      p.times[2] != null &&
      p.times[3] != null &&
      p.times[4] >= Math.max(...p.times.slice(0, 4).map((at) => at ?? Number.POSITIVE_INFINITY)),
  );
  const stages = STAGES.map((event, index) => ({
    event,
    reached: eligible.filter((p) => p.times[index] !== null).length,
    medianMs:
      index === 0
        ? null
        : median(
            eligible.flatMap((p) => {
              const before = p.times[index - 1];
              const after = p.times[index];
              return before != null && after != null && after >= before ? [after - before] : [];
            }),
          ),
  }));
  const recoveries = RECOVERIES.flatMap((kind) =>
    [false, true].map((hintVisible) => {
      let success = 0;
      let abandoned = 0;
      let pending = 0;
      for (const project of projects) {
        const episodes = new Map<number | string, Extract<FunnelRow, { event: "recovery" }>>();
        for (const row of project.timeline) {
          if (row.event !== "recovery" || row.data.kind !== kind) continue;
          const key = row.data.episode ?? `legacy-${kind}`;
          const previous = episodes.get(key);
          if (!previous || previous.data.result === "pending") episodes.set(key, row);
        }
        for (const row of episodes.values()) {
          if (row.data.hintVisible !== hintVisible) continue;
          if (row.data.result === "success") success++;
          else if (row.data.result === "abandoned") abandoned++;
          else pending++;
        }
      }
      return { kind, hintVisible, success, abandoned, pending };
    }),
  );
  return {
    projects,
    total: projects.length,
    baseline: projects.filter((p) => p.baseline).length,
    incomplete: projects.filter((p) => p.incomplete).length,
    imported: imported.length,
    completed: completed.length,
    rate: imported.length ? completed.length / imported.length : null,
    stages,
    recoveries,
  };
};
