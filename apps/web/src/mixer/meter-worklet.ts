// Local AudioWorklet module; no network or third-party DSP. Measurements see
// every rendered sample. Only one message per 2048 frames crosses to main.
export const meterWorkletSource = `
class MixerMeterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.running = true;
    this.port.onmessage = () => { this.running = false; };
    this.master = options.processorOptions?.master === true;
    this.frames = 0; this.count = 0; this.peak = 0; this.sum = 0; this.clipped = 0;
    this.energy = new Float64Array(this.master ? Math.round(sampleRate * 3) : 0);
    this.position = 0; this.seen = 0; this.energySum = 0;
    this.filters = Array.from({length: 2}, () => [new Float64Array(4), new Float64Array(4)]);
    const shelfK = Math.tan(Math.PI * 1681.974450955533 / sampleRate);
    const vh = 10 ** (3.999843853973347 / 20), vb = vh ** 0.4996667741545416;
    const shelfQ = 0.7071752369554196, d = 1 + shelfK / shelfQ + shelfK * shelfK;
    this.pre = [(vh + vb * shelfK / shelfQ + shelfK * shelfK) / d, 2 * (shelfK * shelfK - vh) / d, (vh - vb * shelfK / shelfQ + shelfK * shelfK) / d, 2 * (shelfK * shelfK - 1) / d, (1 - shelfK / shelfQ + shelfK * shelfK) / d];
    const k = Math.tan(Math.PI * 38.13547087602444 / sampleRate), q = 0.5003270373238773, a = 1 + k / q + k * k;
    this.rlb = [1, -2, 1, 2 * (k * k - 1) / a, (1 - k / q + k * k) / a];
  }
  filter(x, s, c) {
    const y = c[0]*x + c[1]*s[0] + c[2]*s[1] - c[3]*s[2] - c[4]*s[3];
    s[1]=s[0]; s[0]=x; s[3]=s[2]; s[2]=y;
    return y;
  }
  process(inputs, outputs) {
    if (!this.running) return false;
    const input = inputs[0], output = outputs[0];
    const length = output[0]?.length ?? 128;
    for (let c = 0; c < output.length; c++) {
      if (input[c]) output[c].set(input[c]); else output[c].fill(0);
    }
    for (let i = 0; i < length; i++) {
      let energy = 0;
      for (let c = 0; c < 2; c++) {
        const x = input[c]?.[i] ?? 0;
        this.peak = Math.max(this.peak, Math.abs(x)); this.sum += x*x; this.count++;
        if (Math.abs(x) > 1) this.clipped++;
        if (this.master) {
          const s = this.filters[c];
          const weighted = this.filter(this.filter(x, s[0], this.pre), s[1], this.rlb);
          energy += weighted*weighted;
        }
      }
      if (this.master) {
        this.energySum += energy - this.energy[this.position];
        this.energy[this.position] = energy;
        this.position = (this.position + 1) % this.energy.length; this.seen++;
      }
    }
    this.frames += length;
    if (this.frames >= 2048) {
      this.port.postMessage({ peak: this.peak, rms: Math.sqrt(this.sum / this.count), clippedSamples: this.clipped,
        shortLufs: this.master && this.seen >= this.energy.length && this.energySum > 0 ? -0.691 + 10*Math.log10(this.energySum / this.energy.length) : null });
      this.frames=0; this.count=0; this.peak=0; this.sum=0; this.clipped=0;
    }
    return true;
  }
}
registerProcessor('movie-desk-meter', MixerMeterProcessor);
`;
