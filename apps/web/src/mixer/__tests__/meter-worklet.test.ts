import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { meterWorkletSource } from "../meter-worklet";

const create = (master = false, sampleRate = 48000) => {
  const messages: {
    peak: number;
    rms: number;
    clippedSamples: number;
    shortLufs: number | null;
  }[] = [];
  let Processor: new (
    options: unknown,
  ) => { process: (input: Float32Array[][], output: Float32Array[][]) => boolean };
  vm.runInNewContext(meterWorkletSource, {
    Float64Array,
    Math,
    sampleRate,
    AudioWorkletProcessor: class {
      port = { postMessage: (value: (typeof messages)[number]) => messages.push(value) };
    },
    registerProcessor: (_name: string, value: typeof Processor) => {
      Processor = value;
    },
  });
  return { processor: new Processor!({ processorOptions: { master } }), messages };
};

describe("meter worklet", () => {
  it("measures a zero-output tap without an audible output connection", () => {
    const { processor, messages } = create();
    const left = new Float32Array(128).fill(0.5);
    const right = new Float32Array(128).fill(-0.5);
    for (let block = 0; block < 16; block++)
      expect(processor.process([[left, right]], [])).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ peak: 0.5, rms: 0.5, clippedSamples: 0 });
  });
  it("passes stereo PCM unchanged, including opposite phase, and captures isolated overload", () => {
    const { processor, messages } = create();
    for (let block = 0; block < 16; block++) {
      const left = Float32Array.from({ length: 128 }, (_, i) =>
        block === 0 && i === 1 ? 1.2 : 0.5,
      );
      const right = left.map((v) => -v);
      const output = [new Float32Array(128), new Float32Array(128)];
      expect(processor.process([[left, right]], [output])).toBe(true);
      expect(output[0]).toEqual(left);
      expect(output[1]).toEqual(right);
    }
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      peak: expect.closeTo(1.2),
      clippedSamples: 2,
      shortLufs: null,
    });
    expect(messages[0]!.rms).toBeGreaterThan(0.5);
  });
  it.each([44100, 48000])(
    "computes contiguous 3-second K-weighted stereo LUFS at %i Hz",
    (sampleRate) => {
      const { processor, messages } = create(true, sampleRate);
      for (let at = 0; at < sampleRate * 4; at += 128) {
        const sine = Float32Array.from(
          { length: 128 },
          (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * (at + i)) / sampleRate),
        );
        processor.process([[sine, sine]], [[new Float32Array(128), new Float32Array(128)]]);
      }
      expect(messages[0]!.shortLufs).toBeNull();
      expect(messages.at(-1)!.shortLufs).toBeCloseTo(-20, 0);
      // Samples stop, so short-term loudness must decay to silence rather than
      // retain an integrated history from earlier playback.
      for (let at = 0; at < sampleRate * 4; at += 128)
        processor.process([[]], [[new Float32Array(128), new Float32Array(128)]]);
      expect(messages.at(-1)!.rms).toBe(0);
      expect(messages.at(-1)!.shortLufs === null || messages.at(-1)!.shortLufs! < -100).toBe(true);
    },
  );
});
