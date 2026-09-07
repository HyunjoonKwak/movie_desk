import {
  type ID,
  type MediaAsset,
  type Project,
  buildAudioSequencePlan,
  type AudioSequencePlan,
  sampleKeyframeTrack,
  stereoPanMatrix,
  sequenceAudioTime,
  sourceOffsetForRamp,
} from "@movie-desk/core";

// Estimates the instantaneous audio level (0..1) at the current playhead by
// sampling precomputed peak envelopes while stopped or scrubbing. Playback
// uses measured audio worklet levels; this remains a phase-blind estimate.
export const playheadStereoLevel = (
  project: Project,
  getAsset: (id: ID) => MediaAsset | undefined,
  getWaveform: (id: ID) => readonly number[] | undefined = (id) => getAsset(id)?.waveformPeaks,
  beforeRootRouting = false,
): readonly [number, number] => {
  const sample = (plan: AudioSequencePlan, at: number): readonly [number, number] => {
    if (at < 0 || (plan.timeline.id !== project.timeline.id && at >= plan.timeline.duration))
      return [0, 0];
    let left = 0;
    let right = 0;
    for (const { clip, route, child } of plan.clips) {
      if (at < clip.start || at >= clip.start + clip.duration) continue;
      let input: readonly [number, number];
      if (clip.kind === "sequence") {
        input = child ? sample(child, sequenceAudioTime(clip, at)) : [0, 0];
      } else {
        const asset = getAsset(clip.assetId);
        const peaks = getWaveform(clip.assetId);
        if (!asset || !peaks?.length) continue;
        const srcMs = clip.trimIn + sourceOffsetForRamp(clip, at - clip.start);
        if (srcMs < 0 || srcMs >= (asset.durationMs || 1)) continue;
        const bin = Math.min(
          peaks.length - 1,
          Math.floor((srcMs / (asset.durationMs || 1)) * peaks.length),
        );
        input = [peaks[bin] ?? 0, peaks[bin] ?? 0];
      }
      const volume = clip.keyframes.find((track) => track.target === "volume");
      const gain =
        (volume
          ? (sampleKeyframeTrack(volume, at - clip.start) ?? clip.volume ?? 1)
          : (clip.volume ?? 1)) *
        route.trackGain *
        route.busGain *
        route.masterGain;
      const [ll, lr, rl, rr] = stereoPanMatrix(route.pan);
      // Phase-blind envelope estimate; preserve loudest-contributor policy.
      left = Math.max(left, (input[0] * ll + input[1] * lr) * gain);
      right = Math.max(right, (input[0] * rl + input[1] * rr) * gain);
    }
    return [left, right];
  };
  return sample(buildAudioSequencePlan(project, beforeRootRouting), project.timeline.playhead);
};

export const playheadLevel = (
  project: Project,
  getAsset: (id: ID) => MediaAsset | undefined,
  getWaveform: (id: ID) => readonly number[] | undefined = (id) => getAsset(id)?.waveformPeaks,
): number => Math.min(1, Math.max(...playheadStereoLevel(project, getAsset, getWaveform)));
