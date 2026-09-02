import type { ID, Ms } from "@movie-desk/core";
import { detectBeatsFromBlob } from "@/ai/beat-detect";
import { readMediaFile } from "@/persistence/opfs";
import type { MusicAnalysis } from "./types";

// --- pure helpers (unit-tested) ---------------------------------------------

export const estimateBpm = (beats: readonly Ms[]): number => {
  if (beats.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i++) gaps.push(beats[i]! - beats[i - 1]!);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  return median > 0 ? Math.round(60000 / median) : 0;
};

// Per-beat energy from a per-second RMS envelope.
export const energyPerBeat = (
  beats: readonly Ms[],
  rmsPerSec: readonly number[],
): readonly number[] =>
  beats.map((b, i) => {
    const end = beats[i + 1] ?? b + 500;
    const s0 = Math.floor(b / 1000);
    const s1 = Math.max(s0, Math.floor((end - 1) / 1000));
    let sum = 0;
    let n = 0;
    for (let s = s0; s <= s1 && s < rmsPerSec.length; s++) {
      sum += rmsPerSec[s]!;
      n++;
    }
    return n > 0 ? sum / n : 0;
  });

// Section boundaries via a lightweight novelty on the RMS envelope: points
// where the mean energy of the next window differs sharply from the previous
// window. Good enough for phrase-boundary trims (intro/build/chorus shifts).
export const noveltySections = (rmsPerSec: readonly number[], windowSec = 4): readonly Ms[] => {
  const bounds: Ms[] = [0];
  const w = Math.max(2, windowSec);
  for (let s = w; s + w <= rmsPerSec.length; s++) {
    let before = 0;
    let after = 0;
    for (let k = 1; k <= w; k++) {
      before += rmsPerSec[s - k]!;
      after += rmsPerSec[s + k - 1]!;
    }
    before /= w;
    after /= w;
    const denom = Math.max(0.05, before + after);
    const novelty = Math.abs(after - before) / denom;
    const last = bounds[bounds.length - 1]!;
    if (novelty > 0.35 && s * 1000 - last > 8000) bounds.push(s * 1000);
  }
  return bounds;
};

// Snap an arbitrary time to the nearest section boundary at or before it —
// used to trim/loop music at musical phrases instead of mid-phrase.
export const phraseBefore = (sections: readonly Ms[], atMs: Ms): Ms => {
  let best = 0;
  for (const s of sections) if (s <= atMs && s > best) best = s;
  return best;
};

// --- browser analysis --------------------------------------------------------

export const analyzeMusic = async (
  assetId: ID,
  opfsPath: string,
  durationMs: Ms,
): Promise<MusicAnalysis | null> => {
  const blob = await readMediaFile(opfsPath);
  if (!blob) return null;
  try {
    const beats = await detectBeatsFromBlob(blob);
    // RMS envelope (per second) from the same decode.
    const buf = await blob.arrayBuffer();
    const Ctx = window.OfflineAudioContext ?? window.AudioContext;
    const ctx = new Ctx(1, 44100, 44100) as OfflineAudioContext;
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const perSec = audio.sampleRate;
    const rms: number[] = [];
    for (let i = 0; i < ch.length; i += perSec) {
      let sum = 0;
      const end = Math.min(ch.length, i + perSec);
      for (let j = i; j < end; j++) sum += ch[j]! * ch[j]!;
      rms.push(Math.sqrt(sum / Math.max(1, end - i)));
    }
    const peak = Math.max(0.0001, ...rms);
    const norm = rms.map((v) => v / peak);
    return {
      assetId,
      durationMs,
      beats,
      bpm: estimateBpm(beats),
      energyPerBeat: energyPerBeat(beats, norm),
      sections: noveltySections(norm),
    };
  } catch {
    return null;
  }
};
