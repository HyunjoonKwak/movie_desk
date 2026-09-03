import {
  allowRemoteWhisperModels,
  WHISPER_MODEL,
  whisperGenerationOptions,
  whisperWasmPaths,
  type WhisperLanguage,
} from "./model-policy";
import type { Subtitle } from "./types";

export type TranscriptionStage = "model" | "decode" | "transcribe" | "done";

// Lazy Whisper loader. The packaged model stays local, and the in-memory
// pipeline is reused for every transcription in the current editor session.
let pipelinePromise: Promise<{
  transcribe: (
    audio: Float32Array,
    language: WhisperLanguage,
  ) => Promise<{
    chunks: Array<{ timestamp: [number, number | null]; text: string }>;
    text: string;
  }>;
}> | null = null;

const loadPipeline = async () => {
  const { pipeline, env } = await import("@huggingface/transformers");
  // Offline-first: prefer a locally vendored copy under /whisper/ if present;
  // browser development may use the explicit Hugging Face fallback.
  // For a fully self-contained desktop bundle, place the model files under
  // `apps/web/public/whisper/Xenova/whisper-base/` (see README).
  env.allowLocalModels = true;
  // Packaged desktop builds include the model. Never hide a broken package by
  // silently reaching HuggingFace from app://; browser development keeps the
  // explicit first-use download path for now.
  env.allowRemoteModels = allowRemoteWhisperModels(globalThis.location?.protocol);
  env.localModelPath = "/whisper/";
  // The bundled model is already local. Duplicating its ~77 MB in Cache
  // Storage can stall model construction and wastes disk space.
  env.useBrowserCache = false;
  // Transformers.js otherwise points ONNX Runtime at jsDelivr. Keep both the
  // model and inference engine local so packaged builds work fully offline.
  const onnxWasm = env.backends.onnx.wasm;
  if (!onnxWasm) throw new Error("Whisper requires the ONNX WebAssembly runtime");
  onnxWasm.wasmPaths = whisperWasmPaths();
  const tx = await pipeline("automatic-speech-recognition", WHISPER_MODEL, {
    dtype: "q8",
    device: "wasm",
  });
  return {
    transcribe: async (audio: Float32Array, language: WhisperLanguage) => {
      const result = (await tx(audio, whisperGenerationOptions(language))) as {
        chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
        text: string;
      };
      return { chunks: result.chunks ?? [], text: result.text };
    },
  };
};

const getWhisper = () => {
  if (!pipelinePromise) {
    pipelinePromise = loadPipeline().catch((error) => {
      // A missing/corrupt bundle must not poison every later retry in the
      // current session after the user repairs the installation.
      pipelinePromise = null;
      throw error;
    });
  }
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
  onProgress?: (stage: TranscriptionStage, pct: number) => void,
  language: WhisperLanguage = "korean",
): Promise<readonly Subtitle[]> => {
  onProgress?.("model", 0.05);
  const whisper = await getWhisper();
  onProgress?.("decode", 0.2);
  const audio = await decodeAudioForWhisper(blob);
  onProgress?.("transcribe", 0.4);
  const result = await whisper.transcribe(audio, language);
  onProgress?.("done", 1);
  return result.chunks
    .filter((c): c is { timestamp: [number, number]; text: string } => c.timestamp[1] !== null)
    .map((c) => ({
      start: Math.round(c.timestamp[0] * 1000),
      end: Math.round(c.timestamp[1] * 1000),
      text: c.text.trim(),
    }))
    .filter((s) => s.text.length > 0);
};
