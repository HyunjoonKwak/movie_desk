import type { Ms } from "@movie-desk/core";
import type { MusicAnalysis } from "./types";

// Re-conform — design: 음악 후속 삽입/교체 시 자동 보정, 강도 ①.
// Pure: operates on ordered, contiguous segment lengths (the auto-edit track)
// and a new beat grid; returns adjusted lengths + a change report. Cut points
// only move when the nudge stays within ±tolerance of the beat interval, so
// user-made content decisions survive; only timing breathes.

export interface ReconformInput {
  readonly durations: readonly Ms[]; // contiguous segment lengths, in order
  readonly photoFlags: readonly boolean[]; // photos re-quantize to whole beats
  readonly beats: readonly Ms[]; // new music beat times (timeline-relative)
  readonly toleranceFrac?: number; // fraction of beat interval (default 0.4)
  readonly minSegmentMs?: number; // never shrink a segment below this
}

export interface ReconformResult {
  readonly durations: readonly Ms[];
  readonly report: {
    readonly snapped: number;
    readonly requantized: number;
    readonly skipped: number;
  };
}

const nearestBeat = (beats: readonly Ms[], at: Ms): Ms | null => {
  if (beats.length === 0) return null;
  let best = beats[0]!;
  let bestD = Math.abs(at - best);
  for (const b of beats) {
    const d = Math.abs(at - b);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
};

export const beatSnap = (input: ReconformInput): ReconformResult => {
  const tolFrac = input.toleranceFrac ?? 0.4;
  const minSeg = input.minSegmentMs ?? 400;
  const { beats } = input;
  const interval =
    beats.length > 1
      ? (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1)
      : 500;
  const tol = interval * tolFrac;

  const durations = [...input.durations];
  let snapped = 0;
  let requantized = 0;
  let skipped = 0;

  // Walk interior boundaries; boundary i sits after segment i.
  let boundary = 0;
  for (let i = 0; i < durations.length - 1; i++) {
    boundary += durations[i]!;
    const beat = nearestBeat(beats, boundary);
    if (beat === null) continue;
    const delta = beat - boundary;
    if (delta === 0) continue;
    if (Math.abs(delta) > tol) {
      skipped++;
      continue;
    }
    const grow = durations[i]! + delta;
    const shrink = durations[i + 1]! - delta;
    if (grow < minSeg || shrink < minSeg) {
      skipped++;
      continue;
    }
    durations[i] = grow;
    durations[i + 1] = shrink;
    boundary = boundary + delta;
    snapped++;
  }

  // Photos re-quantize to whole beats (nearest ≥1 beat).
  for (let i = 0; i < durations.length; i++) {
    if (!input.photoFlags[i]) continue;
    const beatsHeld = Math.max(1, Math.round(durations[i]! / interval));
    const q = Math.round(beatsHeld * interval);
    if (Math.abs(q - durations[i]!) > 1) {
      durations[i] = q;
      requantized++;
    }
  }

  return { durations, report: { snapped, requantized, skipped } };
};

// Beat times relative to the music clip's position on the timeline.
export const timelineBeats = (music: MusicAnalysis, musicStartMs: Ms): readonly Ms[] =>
  music.beats.map((b) => b + musicStartMs);
