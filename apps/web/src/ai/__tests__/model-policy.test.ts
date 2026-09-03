import { describe, expect, it } from "vitest";
import {
  FACE_LANDMARKER_MODEL_PATH,
  WHISPER_MODEL,
  allowRemoteWhisperModels,
  whisperGenerationOptions,
  whisperWasmPaths,
} from "../model-policy";

describe("desktop AI model policy", () => {
  it("uses only the bundled Whisper model in the packaged app", () => {
    expect(allowRemoteWhisperModels("app:")).toBe(false);
  });

  it("allows the documented development fallback outside the packaged app", () => {
    expect(allowRemoteWhisperModels("http:")).toBe(true);
    expect(allowRemoteWhisperModels("https:")).toBe(true);
  });

  it("keeps face analysis on a local model path", () => {
    expect(FACE_LANDMARKER_MODEL_PATH).toBe("/mediapipe/models/face_landmarker.task");
    expect(FACE_LANDMARKER_MODEL_PATH).not.toMatch(/^https?:/);
  });

  it("uses multilingual base and always transcribes the selected language", () => {
    expect(WHISPER_MODEL).toBe("Xenova/whisper-base");
    expect(whisperGenerationOptions("korean")).toMatchObject({
      language: "korean",
      task: "transcribe",
      return_timestamps: true,
    });
  });

  it("keeps the CPU ONNX Runtime local", () => {
    expect(whisperWasmPaths()).toEqual({
      mjs: "/whisper/ort/ort-wasm-simd-threaded.jsep.mjs",
      wasm: "/whisper/ort/ort-wasm-simd-threaded.jsep.wasm",
    });
  });
});
