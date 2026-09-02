import { newId, type ID, type Project } from "@movie-desk/core";
import { addEffectToClip } from "@movie-desk/core";

// Lazy MediaPipe Selfie Segmenter. Heavy (~10MB) so we only load when first
// needed.
let segmenterPromise: Promise<{
  segmentFor(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<ImageData | null>;
}> | null = null;

// Locally vendored wasm + model assets (see apps/web/public/mediapipe/).
// Keeps the app fully offline-capable and ready for the desktop bundle —
// no jsdelivr / storage.googleapis hits at runtime.
const MP_WASM_DIR = "/mediapipe/wasm";
const MP_SEGMENTER_MODEL = "/mediapipe/models/selfie_segmenter.tflite";

const loadSegmenter = async () => {
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM_DIR);
  const segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MP_SEGMENTER_MODEL },
    runningMode: "IMAGE",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });

  return {
    segmentFor: async (
      source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    ): Promise<ImageData | null> => {
      const result = segmenter.segment(source);
      const mask = result.categoryMask;
      if (!mask) return null;
      const width = mask.width;
      const height = mask.height;
      const data = new Uint8ClampedArray(width * height * 4);
      const maskData = mask.getAsUint8Array();
      for (let i = 0; i < width * height; i++) {
        const v = maskData[i] === 0 ? 255 : 0; // 0 = person, others = background
        data[i * 4 + 0] = v;
        data[i * 4 + 1] = v;
        data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
      }
      mask.close();
      return new ImageData(data, width, height);
    },
  };
};

export const getSegmenter = () => {
  if (!segmenterPromise) segmenterPromise = loadSegmenter();
  return segmenterPromise;
};

// Public entry called from the AI panel — append the bg-remove effect to a
// clip if it doesn't already have one.
export const addBackgroundRemovalEffect = (project: Project, clipId: ID): Project => {
  const clip = project.timeline.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === clipId);
  if (!clip) return project;
  if (clip.effects.some((e) => e.type === "bg-remove")) return project;
  return addEffectToClip(project, clipId, {
    id: newId(),
    type: "bg-remove",
    enabled: true,
    params: { feather: 0.05 },
  });
};
