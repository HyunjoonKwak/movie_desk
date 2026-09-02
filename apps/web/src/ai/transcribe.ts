import { allowRemoteWhisperModels } from "./model-policy";
import type { Subtitle } from "./types";

// Lazy Whisper loader. The model is downloaded once and cached by the
// transformers runtime via the browser's HTTP cache.
let pipelinePromise: Promise<{
  transcribe: (audio: Float32Array) => Promise<{
    chunks: Array<{ timestamp: [number, number | null]; text: string }>;
    text: string;
  }>;
}> | null = null;

const loadPipeline = async () => {
  const { pipeline, env } = await import("@huggingface/transformers");
  // Offline-first: prefer a locally vendored copy under /whisper/ if present;
  // otherwise download from HuggingFace once and rely on the browser cache.
  // For a fully self-contained desktop bundle, place the model files under
  // `apps/web/public/whisper/Xenova/whisper-tiny.en/` (see README).
  env.allowLocalModels = true;
  // Packaged desktop builds include the model. Never hide a broken package by
  // silently reaching HuggingFace from app://; browser development keeps the
  // explicit first-use download path for now.
  env.allowRemoteModels = allowRemoteWhisperModels(globalThis.location?.protocol);
  env.localModelPath = "/whisper/";
  env.useBrowserCache = true;
  const tx = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
    dtype: "q8",
  });
  return {
    transcribe: async (audio: Float32Array) => {
      const result = (await tx(audio, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      })) as { chunks?: Array<{ timestamp: [number, number | null]; text: string }>; text: string };
      return { chunks: result.chunks ?? [], text: result.text };
    },
  };
};

const getWhisper = () => {
  if (!pipelinePromise) pipelinePromise = loadPipeline();
  return pipelinePromise;
};

// Decode any Blob (audio or video) to mono 16 kHz float samples, which is
// the input format Whisper expects.
const decodeAudioForWhisper = async (blob: Blob): Promise<Float32Array> => {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 16_000, 16_000);
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  // Resample to 16 kHz mono.
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16_000), 16_000);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
};

export const transcribeAudio = async (
  blob: Blob,
  onProgress?: (label: string, pct: number) => void,
): Promise<readonly Subtitle[]> => {
  onProgress?.("Loading Whisper model", 0.05);
  const whisper = await getWhisper();
  onProgress?.("Decoding audio", 0.2);
  const audio = await decodeAudioForWhisper(blob);
  onProgress?.("Transcribing", 0.4);
  const result = await whisper.transcribe(audio);
  onProgress?.("Done", 1);
  return result.chunks
    .filter((c): c is { timestamp: [number, number]; text: string } => c.timestamp[1] !== null)
    .map((c) => ({
      start: Math.round(c.timestamp[0] * 1000),
      end: Math.round(c.timestamp[1] * 1000),
      text: c.text.trim(),
    }))
    .filter((s) => s.text.length > 0);
};
