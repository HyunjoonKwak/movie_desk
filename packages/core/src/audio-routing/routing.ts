import type { Project, Timeline } from "../model/project";
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

// Sequence routes use local solo and omit project bus/master below root.
export const resolveTrackRoute = (
  project: Project,
  track: Track,
  timeline: Timeline = project.timeline,
  includeProjectOutput = true,
): TrackRoute => {
  const solo = timeline.tracks.some((candidate) => candidate.solo);
  const bus = includeProjectOutput
    ? project.audio?.buses.find((candidate) => candidate.id === track.audio?.busId)
    : undefined;
  return {
    trackGain: track.muted || (solo && !track.solo) ? 0 : gain(track.audio?.gainDb),
    pan: Number.isFinite(track.audio?.pan) ? Math.max(-1, Math.min(1, track.audio?.pan ?? 0)) : 0,
    busId: bus?.id ?? null,
    busGain: bus?.muted ? 0 : gain(bus?.gainDb),
    masterGain: includeProjectOutput ? gain(project.audio?.master.gainDb) : 1,
  };
};

// Clip volume automation is evaluated before this stage and replaces base
// clip volume. Routing multiplies that resulting PCM, never base volume again.
// Optional scratch is caller-owned and must not alias inputs or the other output.
// Returned views borrow it until the next write; omitting it returns owned PCM.
export const routeStereo = (
  channels: readonly Float32Array[],
  route: TrackRoute,
  scratch?: readonly [Float32Array, Float32Array],
): readonly [Float32Array, Float32Array] => {
  const left = channels[0] ?? new Float32Array(0);
  const right = channels[1] ?? left;
  const output = scratch ?? [new Float32Array(left.length), new Float32Array(left.length)];
  if (
    scratch &&
    (scratch.some((channel) => channel.length < left.length) ||
      scratch[0].buffer === scratch[1].buffer ||
      scratch.some((output) => channels.some((input) => input.buffer === output.buffer)))
  )
    throw new Error("Routing scratch must have sufficient capacity and independent buffers");
  const [ll, lr, rl, rr] = stereoPanMatrix(route.pan);
  const totalGain = route.trackGain * route.busGain * route.masterGain;
  for (let i = 0; i < left.length; i++) {
    const l = left[i]!;
    const r = right[i] ?? 0;
    output[0]![i] = (l * ll + r * lr) * totalGain;
    output[1]![i] = (l * rl + r * rr) * totalGain;
  }
  return [output[0]!.subarray(0, left.length), output[1]!.subarray(0, left.length)];
};
