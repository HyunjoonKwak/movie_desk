export const FACE_LANDMARKER_MODEL_PATH = "/mediapipe/models/face_landmarker.task";

// The macOS app is expected to be self-contained. Browser development keeps
// an explicit first-use download fallback so contributors can run the UI
// without producing a desktop package first.
export const allowRemoteWhisperModels = (protocol: string | undefined): boolean =>
  protocol !== "app:";
