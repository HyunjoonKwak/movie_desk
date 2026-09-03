// Audio mixer worker — runs the bus-combine + sidechain-ducking + soft-limiter
// pass off the main thread. The mixer's per-clip stage stays on main because
// it depends on `OfflineAudioContext` (decode + biquad EQ) which is unavailable
// in regular workers. Once the per-clip stage has summed everything into
// stereo voice/music buses, those typed arrays are transferred here and the
// final PCM channels are transferred back — zero copies in either direction.

type StereoChannels = [Float32Array, Float32Array];

export interface MixerWorkerRequest {
  readonly requestId?: number;
  readonly voiceChannels: StereoChannels;
  readonly musicChannels: StereoChannels;
  readonly sampleRate: number;
  readonly initialDuckGain?: number;
  readonly ducking?: { enabled: boolean; amountDb: number; thresholdDb: number };
}

export interface MixerWorkerResponse {
  readonly requestId?: number;
  readonly channels: StereoChannels;
  readonly finalDuckGain: number;
}

const combine = (req: MixerWorkerRequest): MixerWorkerResponse => {
  const { voiceChannels, musicChannels, ducking } = req;
  const totalSamples = voiceChannels[0].length;
  const accum: StereoChannels = [new Float32Array(totalSamples), new Float32Array(totalSamples)];
  let finalDuckGain = req.initialDuckGain ?? 1;
  if (ducking?.enabled) {
    const duckGain = 10 ** (ducking.amountDb / 20);
    const threshold = 10 ** (ducking.thresholdDb / 20);
    let gain = finalDuckGain;
    for (let i = 0; i < totalSamples; i++) {
      const voiceLevel = Math.max(Math.abs(voiceChannels[0][i]!), Math.abs(voiceChannels[1][i]!));
      const target = voiceLevel > threshold ? duckGain : 1;
      gain += (target - gain) * 0.002;
      accum[0][i] = voiceChannels[0][i]! + musicChannels[0][i]! * gain;
      accum[1][i] = voiceChannels[1][i]! + musicChannels[1][i]! * gain;
    }
    finalDuckGain = gain;
  } else {
    for (let channel = 0; channel < 2; channel++) {
      const output = accum[channel]!;
      const voice = voiceChannels[channel]!;
      const music = musicChannels[channel]!;
      for (let i = 0; i < totalSamples; i++) {
        output[i] = voice[i]! + music[i]!;
      }
    }
  }
  // Limit each stereo sample with one shared gain. Unlike normalizing against
  // the peak of an entire chunk, this produces identical output regardless of
  // where streaming chunk boundaries happen to fall.
  for (let i = 0; i < totalSamples; i++) {
    const peak = Math.max(Math.abs(accum[0][i]!), Math.abs(accum[1][i]!));
    if (peak > 1) {
      const gain = 1 / peak;
      accum[0][i]! *= gain;
      accum[1][i]! *= gain;
    }
  }
  return { channels: accum, finalDuckGain };
};

// Worker entry. Guarded to a REAL worker scope: `"onmessage" in self` is also
// true on the main thread (window), where importing this module for
// combineInlineStateful used to hijack window.onmessage — every unrelated
// window message (e.g. a postMessage from another window) then crashed into
// combine(). Don't test `typeof window` here: the dev bundler folds it to a
// constant for browser targets and drops this whole block as unreachable,
// leaving a worker that never answers. `WorkerGlobalScope` only exists off
// the main thread and is not folded.
const workerScope = (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope;
const inWorker =
  typeof workerScope === "function" && self instanceof (workerScope as new () => object);
if (inWorker && "onmessage" in self) {
  (self as unknown as Worker).onmessage = (e: MessageEvent<MixerWorkerRequest>) => {
    const result = combine(e.data);
    (self as unknown as Worker).postMessage(
      {
        ...(e.data.requestId === undefined ? {} : { requestId: e.data.requestId }),
        ...result,
      } satisfies MixerWorkerResponse,
      [result.channels[0].buffer, result.channels[1].buffer],
    );
  };
}

// Fallback used by callers when Worker isn't available (jsdom / SSR).
export const combineInline = (request: MixerWorkerRequest): StereoChannels =>
  combine(request).channels;

export const combineInlineStateful = combine;
