// WebCodecs does not expose AAC encoder delay. Calibrate the actual local
// encoder/decoder pair once per configuration instead of guessing by browser.
// Preroll protects the first user samples on backends which silence startup.
export const AAC_PREROLL_SAMPLES = 4096;
const SAMPLE_RATE = 48000;
const cache = new Map<number, Promise<number>>();

export const measureAacPriming = (bitrate: number): Promise<number> => {
  const cached = cache.get(bitrate);
  if (cached) return cached;
  const promise = calibrate(bitrate).catch((error) => {
    cache.delete(bitrate);
    throw error;
  });
  cache.set(bitrate, promise);
  return promise;
};

const calibrate = async (bitrate: number): Promise<number> => {
  const frames = 12288;
  const referenceLength = 128;
  const pcm = new Float32Array(frames * 2);
  for (let i = 0; i < referenceLength; i++) {
    const value = Math.sin(i * i * 0.173) * 0.7;
    pcm[AAC_PREROLL_SAMPLES + i] = value;
    pcm[frames + AAC_PREROLL_SAMPLES + i] = value;
  }
  const chunks: EncodedAudioChunk[] = [];
  let config: AudioDecoderConfig | undefined;
  let failure: DOMException | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      chunks.push(chunk);
      if (meta?.decoderConfig) config = meta.decoderConfig;
    },
    error: (error) => {
      failure = error;
    },
  });
  try {
    encoder.configure({
      codec: "mp4a.40.2",
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 2,
      bitrate,
    });
    const sample = new AudioData({
      format: "f32-planar",
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 2,
      numberOfFrames: frames,
      timestamp: 0,
      data: pcm,
    });
    try {
      encoder.encode(sample);
    } finally {
      sample.close();
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  if (failure) throw failure;
  if (!config) throw new Error("AAC calibration returned no decoder configuration");
  const blocks: Float32Array[] = [];
  const decoder = new AudioDecoder({
    output: (sample) => {
      try {
        const block = new Float32Array(sample.numberOfFrames);
        sample.copyTo(block, { planeIndex: 0, format: "f32-planar" });
        blocks.push(block);
      } finally {
        sample.close();
      }
    },
    error: (error) => {
      failure = error;
    },
  });
  try {
    decoder.configure(config);
    for (const chunk of chunks) decoder.decode(chunk);
    await decoder.flush();
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }
  if (failure) throw failure;
  const decoded = new Float32Array(blocks.reduce((sum, block) => sum + block.length, 0));
  let position = 0;
  for (const block of blocks) {
    decoded.set(block, position);
    position += block.length;
  }
  let bestScore = 0;
  let bestLag = -1;
  for (let lag = 0; lag < 8192; lag++) {
    let dot = 0;
    for (let i = 0; i < referenceLength; i++) {
      dot += (decoded[AAC_PREROLL_SAMPLES + lag + i] ?? 0) * pcm[AAC_PREROLL_SAMPLES + i]!;
    }
    if (dot > bestScore) {
      bestScore = dot;
      bestLag = lag;
    }
    if (lag % 512 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (bestScore < 1 || bestLag < 0 || bestLag >= 8191)
    throw new Error("AAC priming calibration failed");
  return bestLag;
};
