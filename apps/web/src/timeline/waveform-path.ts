// The peak envelope of a clip as an SVG path. `band` is the share of the
// clip height the waveform occupies, anchored at the bottom: a video clip
// keeps its filmstrip on top and the sound in the lower band, an audio clip
// fills the whole height.
export interface WaveformPathOptions {
  readonly width: number;
  readonly height: number;
  readonly band?: number;
  readonly from: number; // fraction of the peaks to start from, 0–1
  readonly to: number; // fraction of the peaks to end at, 0–1
}

export const waveformPath = (
  peaks: readonly number[],
  options: WaveformPathOptions,
): string | null => {
  if (peaks.length === 0) return null;
  const band = Math.min(1, Math.max(0.05, options.band ?? 1));
  const bandHeight = options.height * band;
  const mid = options.height - bandHeight / 2;
  const startFrac = Math.max(0, Math.min(1, options.from));
  const endFrac = Math.max(startFrac, Math.min(1, options.to));
  const from = Math.floor(startFrac * peaks.length);
  const to = Math.max(from + 1, Math.floor(endFrac * peaks.length));
  const slice = peaks.slice(from, to);
  const n = slice.length;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / Math.max(1, n - 1)) * options.width;
    const amp = (slice[i]! * bandHeight) / 2;
    top.push(`${x.toFixed(1)},${(mid - amp).toFixed(1)}`);
    bottom.push(`${x.toFixed(1)},${(mid + amp).toFixed(1)}`);
  }
  return `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
};
