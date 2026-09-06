/** YouTube chapter timestamps use wall-clock seconds, never frame timecode. */
const stamp = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

export const chapterExportLines = (
  markers: readonly { at: number; label: string }[],
  intro: string,
  untitled: string,
): string[] => {
  const sorted = [...markers].sort((a, b) => a.at - b.at);
  const lines: string[] = [];
  if (sorted.length === 0 || sorted[0]!.at > 0) lines.push(`0:00 ${intro}`);
  for (const marker of sorted) lines.push(`${stamp(marker.at)} ${marker.label || untitled}`);
  return lines;
};
