export interface SignalLevel {
  readonly peak: number;
  readonly rms: number;
  readonly clippedSamples: number;
}

export const measureSignal = (channels: readonly Float32Array[]): SignalLevel => {
  let peak = 0;
  let sum = 0;
  let count = 0;
  let clippedSamples = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i]!;
      peak = Math.max(peak, Math.abs(sample));
      sum += sample * sample;
      count++;
      if (Math.abs(sample) > 1) clippedSamples++;
    }
  }
  return { peak, rms: count ? Math.sqrt(sum / count) : 0, clippedSamples };
};

export interface HeldLevel extends SignalLevel {
  readonly heldPeak: number;
  readonly clipping: boolean;
}

export class PeakHold {
  private peak = 0;
  private expires = 0;
  private clipExpires = 0;

  update(level: SignalLevel, nowMs: number): HeldLevel {
    if (level.peak >= this.peak || nowMs >= this.expires) {
      this.peak = level.peak;
      this.expires = nowMs + 1500;
    }
    if (level.peak >= 1) this.clipExpires = nowMs + 1500;
    return { ...level, heldPeak: this.peak, clipping: nowMs < this.clipExpires };
  }
}

// Four-times, 16-tap windowed-sinc interpolation. This is an approximation,
// not a certified BS.1770 true-peak implementation. Rings survive chunk edges.
const TAPS = 16;
const phases = [0.25, 0.5, 0.75].map((phase) => {
  const coefficients = Array.from({ length: TAPS }, (_, k) => {
    const x = k - (7 + phase);
    const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    return sinc * (0.5 + 0.5 * Math.cos((Math.PI * x) / 8));
  });
  const sum = coefficients.reduce((a, b) => a + b, 0);
  return coefficients.map((value) => value / sum);
});

export interface AudioPeakResult {
  readonly samplePeak: number;
  readonly truePeak: number;
  readonly clippedSamples: number;
}

export interface TruePeakCheckpoint extends AudioPeakResult {
  readonly rings: readonly Float64Array[];
  readonly index: number;
}

export class TruePeakMeter {
  private readonly rings: Float64Array[];
  private index = 0;
  private samplePeak = 0;
  private truePeak = 0;
  private clippedSamples = 0;

  constructor(channelCount = 2) {
    this.rings = Array.from({ length: channelCount }, () => new Float64Array(TAPS));
  }

  // Detached snapshots keep concurrent exports and worker retries independent.
  checkpoint(): TruePeakCheckpoint {
    return {
      rings: this.rings.map((ring) => ring.slice()),
      index: this.index,
      samplePeak: this.samplePeak,
      truePeak: this.truePeak,
      clippedSamples: this.clippedSamples,
    };
  }

  restore(state: TruePeakCheckpoint): void {
    if (
      state.rings.length !== this.rings.length ||
      state.rings.some((ring) => ring.length !== TAPS)
    ) {
      throw new Error("TruePeakCheckpoint channel count or ring length mismatch");
    }
    state.rings.forEach((ring, channel) => this.rings[channel]!.set(ring));
    this.index = state.index;
    this.samplePeak = state.samplePeak;
    this.truePeak = state.truePeak;
    this.clippedSamples = state.clippedSamples;
  }

  push(channels: readonly Float32Array[], gain = 1): void {
    const length = Math.min(...channels.map((channel) => channel.length));
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < Math.min(channels.length, this.rings.length); c++) {
        const sample = channels[c]![i]! * gain;
        this.samplePeak = Math.max(this.samplePeak, Math.abs(sample));
        if (Math.abs(sample) > 1) this.clippedSamples++;
        this.interpolate(c, sample);
      }
      this.index = (this.index + 1) % TAPS;
    }
  }

  private interpolate(channel: number, sample: number): void {
    const ring = this.rings[channel]!;
    ring[this.index] = sample;
    for (const coefficients of phases) {
      let value = 0;
      for (let k = 0; k < TAPS; k++)
        value += ring[(this.index - k + TAPS) % TAPS]! * coefficients[k]!;
      this.truePeak = Math.max(this.truePeak, Math.abs(value));
    }
  }

  finish(): AudioPeakResult {
    // Flush interpolation latency without counting synthetic samples as input.
    for (let i = 0; i < TAPS; i++) {
      for (let c = 0; c < this.rings.length; c++) this.interpolate(c, 0);
      this.index = (this.index + 1) % TAPS;
    }
    return this.result();
  }

  result(): AudioPeakResult {
    return {
      samplePeak: this.samplePeak,
      truePeak: Math.max(this.samplePeak, this.truePeak),
      clippedSamples: this.clippedSamples,
    };
  }
}
