import type { MediaAsset } from "@movie-desk/core";
import { blurVariance, classifyShake, estimateShift, exposureStats, judgeJunk, motionDiff, toLuma } from "./quality";
import { fuseInterest } from "./interest";
import { samplePhoto, sampleVideo, sampleAudioRms } from "./sampler";
import type { AssetAnalysis, FrameSample } from "./types";
import { scoreSmiles } from "./smile";
import { semanticScore } from "./semantic";

// Analyse one asset end-to-end. Heavy pieces degrade gracefully: audio decode
// failure yields no RMS, face model absence yields no smile signal, etc.
export const analyzeAsset = async (
  asset: MediaAsset,
  onProgress?: (p: number) => void,
): Promise<AssetAnalysis | null> => {
  if (asset.kind === "image") {
    const frame = await samplePhoto(asset);
    if (!frame) return null;
    const luma = toLuma(frame.image);
    const exp = exposureStats(luma);
    const smile = await scoreSmiles([frame.image]);
    const sem = await semanticScore([frame.image]);
    const sample: FrameSample = {
      atMs: 0,
      blurVar: blurVariance(luma),
      exposureLow: exp.low,
      exposureHigh: exp.high,
      entropy: exp.entropy,
      motion: 0,
      ...(smile?.[0] !== undefined
        ? { smile: smile[0].smile, faceArea: smile[0].faceArea, faceCx: smile[0].faceCx }
        : {}),
    };
    const verdict = judgeJunk(
      [{ blurVar: sample.blurVar, low: exp.low, high: exp.high, entropy: exp.entropy }],
      "stable",
      0,
    );
    const interest = fuseInterest([sample], verdict.quality, {
      ...(sem ? { semantic: sem.perSample, aesthetic: sem.aesthetic } : {}),
    });
    onProgress?.(1);
    return {
      assetId: asset.id,
      kind: "image",
      durationMs: 0,
      samples: [sample],
      shakeTier: "stable",
      junk: verdict.reasons.filter((r) => r !== "too-short"),
      interest,
      quality: verdict.quality,
      ...(sem?.embedding ? { embedding: sem.embedding } : {}),
      ...(sem?.tags ? { semanticTags: sem.tags } : {}),
      ...(sem?.aesthetic !== undefined ? { aesthetic: sem.aesthetic } : {}),
    };
  }

  if (asset.kind === "audio") {
    const rms = await sampleAudioRms(asset);
    onProgress?.(1);
    return {
      assetId: asset.id,
      kind: "audio",
      durationMs: asset.durationMs,
      samples: [],
      ...(rms ? { audioRms: rms } : {}),
      shakeTier: "stable",
      junk: [],
      interest: rms ? [...rms] : [],
      quality: 1,
    };
  }

  // video
  const sampled = await sampleVideo(asset, (p) => onProgress?.(p * 0.7));
  if (!sampled) return null;
  const lumas = sampled.frames.map((f) => toLuma(f.image));
  const smiles = await scoreSmiles(sampled.frames.map((f) => f.image));
  const sem = await semanticScore(sampled.frames.map((f) => f.image));
  const samples: FrameSample[] = sampled.frames.map((f, i) => {
    const exp = exposureStats(lumas[i]!);
    return {
      atMs: f.atMs,
      blurVar: blurVariance(lumas[i]!),
      exposureLow: exp.low,
      exposureHigh: exp.high,
      entropy: exp.entropy,
      motion: i > 0 ? motionDiff(lumas[i - 1]!, lumas[i]!) : 0,
      ...(smiles?.[i] !== undefined
        ? { smile: smiles[i].smile, faceArea: smiles[i].faceArea, faceCx: smiles[i].faceCx }
        : {}),
    };
  });
  onProgress?.(0.8);

  const shifts = sampled.bursts.flatMap((burst) => {
    const bl = burst.map((f) => toLuma(f.image));
    const out: { dx: number; dy: number }[] = [];
    for (let i = 1; i < bl.length; i++) out.push(estimateShift(bl[i - 1]!, bl[i]!));
    return out;
  });
  const shakeTier = classifyShake(shifts);

  const verdict = judgeJunk(
    samples.map((s) => ({ blurVar: s.blurVar, low: s.exposureLow, high: s.exposureHigh, entropy: s.entropy })),
    shakeTier,
    asset.durationMs,
  );
  const audioRms = (await sampleAudioRms(asset)) ?? undefined;
  onProgress?.(0.95);
  const interest = fuseInterest(samples, verdict.quality, {
    ...(audioRms ? { audioRms } : {}),
    ...(sem ? { semantic: sem.perSample, aesthetic: sem.aesthetic } : {}),
  });
  onProgress?.(1);
  return {
    assetId: asset.id,
    kind: "video",
    durationMs: asset.durationMs,
    samples,
    ...(audioRms ? { audioRms } : {}),
    shakeTier,
    junk: verdict.reasons,
    interest,
    quality: verdict.quality,
    ...(sem?.embedding ? { embedding: sem.embedding } : {}),
    ...(sem?.tags ? { semanticTags: sem.tags } : {}),
    ...(sem?.aesthetic !== undefined ? { aesthetic: sem.aesthetic } : {}),
  };
};
