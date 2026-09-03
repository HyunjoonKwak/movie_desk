export const FACE_LANDMARKER_MODEL_PATH = "/mediapipe/models/face_landmarker.task";
export const WHISPER_MODEL = "Xenova/whisper-base";
const WHISPER_RUNTIME_ROOT = "/whisper/ort";
export type WhisperLanguage = "korean" | "english";

export const whisperWasmPaths = (): { readonly mjs: string; readonly wasm: string } => {
  const variant = "ort-wasm-simd-threaded.jsep";
  return {
    mjs: `${WHISPER_RUNTIME_ROOT}/${variant}.mjs`,
    wasm: `${WHISPER_RUNTIME_ROOT}/${variant}.wasm`,
  };
};

export const whisperGenerationOptions = (language: WhisperLanguage) => ({
  language,
  task: "transcribe" as const,
  return_timestamps: true,
  chunk_length_s: 30,
  stride_length_s: 5,
});

// The macOS app is expected to be self-contained. Browser development keeps
// an explicit first-use download fallback so contributors can run the UI
// without producing a desktop package first.
export const allowRemoteWhisperModels = (protocol: string | undefined): boolean =>
  protocol !== "app:";
