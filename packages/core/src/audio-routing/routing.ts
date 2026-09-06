import type { Project } from "../model/project";
import type { Track } from "../model/track";

export const dbToLinear = (db: number): number => 10 ** (db / 20);
export const linearToDb = (linear: number): number =>
  linear > 0 ? 20 * Math.log10(linear) : Number.NEGATIVE_INFINITY;
const gain = (db = 0) => dbToLinear(Number.isFinite(db) ? Math.max(-60, Math.min(12, db)) : 0);

// [LL, LR, RL, RR]: Web Audio stereo panning, after explicit stereo upmix.
export const stereoPanMatrix = (value = 0): readonly [number, number, number, number] => {
  const pan = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  if (pan === 0) return [1, 0, 0, 1];
  if (pan < 0) {
    const angle = ((pan + 1) * Math.PI) / 2;
    return [1, Math.cos(angle), 0, Math.sin(angle)];
  }
  const angle = (pan * Math.PI) / 2;
  return [Math.cos(angle), 0, Math.sin(angle), 1];
};

export interface TrackRoute {
  readonly trackGain: number;
  readonly pan: number;
  readonly busId: string | null;
  readonly busGain: number;
  readonly masterGain: number;
}

export const resolveTrackRoute = (project: Project, track: Track): TrackRoute => {
  const solo = project.timeline.tracks.some((candidate) => candidate.solo);
  const bus = project.audio?.buses.find((candidate) => candidate.id === track.audio?.busId);
  return {
    trackGain: track.muted || (solo && !track.solo) ? 0 : gain(track.audio?.gainDb),
    pan: Number.isFinite(track.audio?.pan) ? Math.max(-1, Math.min(1, track.audio?.pan ?? 0)) : 0,
    busId: bus?.id ?? null,
    busGain: bus?.muted ? 0 : gain(bus?.gainDb),
    masterGain: gain(project.audio?.master.gainDb),
  };
};

// Clip volume automation is evaluated before this stage and replaces base
// clip volume. Routing multiplies that resulting PCM, never base volume again.
export const routeStereo = (
  channels: readonly Float32Array[],
  route: TrackRoute,
): readonly [Float32Array, Float32Array] => {
  const left = channels[0] ?? new Float32Array(0);
  const right = channels[1] ?? left;
  const output: [Float32Array, Float32Array] = [
    new Float32Array(left.length),
    new Float32Array(left.length),
  ];
  const [ll, lr, rl, rr] = stereoPanMatrix(route.pan);
  const totalGain = route.trackGain * route.busGain * route.masterGain;
  for (let i = 0; i < left.length; i++) {
    const l = left[i]!;
    const r = right[i] ?? 0;
    output[0][i] = (l * ll + r * lr) * totalGain;
    output[1][i] = (l * rl + r * rr) * totalGain;
  }
  return output;
};
