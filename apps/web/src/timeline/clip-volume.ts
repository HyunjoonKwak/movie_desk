// The volume line drawn across an audio-bearing clip: linear 0–2× like the
// inspector slider, so 100 % sits mid-height and the two agree exactly.
export const MAX_CLIP_GAIN = 2;

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

export const yForGain = (gain: number, height: number): number =>
  height * (1 - clamp(gain, 0, MAX_CLIP_GAIN) / MAX_CLIP_GAIN);

export const gainAtY = (y: number, height: number): number =>
  clamp((1 - y / Math.max(1, height)) * MAX_CLIP_GAIN, 0, MAX_CLIP_GAIN);

// Readout: percent plus decibels, the way an editor thinks about gain.
export const formatGain = (gain: number): string => {
  const percent = Math.round(gain * 100);
  if (gain <= 0) return `${percent}% · −∞ dB`;
  const db = 20 * Math.log10(gain);
  const sign = db > 0 ? "+" : db < 0 ? "−" : "";
  return `${percent}% · ${sign}${Math.abs(db).toFixed(1)} dB`;
};
