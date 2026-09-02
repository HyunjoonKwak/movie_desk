// P4 — family signals via MediaPipe FaceLandmarker blendshapes.
// Contract: returns null when the model is unavailable (offline, load failure)
// so the interest fusion simply proceeds without the smile term.

export interface SmileSample {
  readonly smile: number; // mean(mouthSmileLeft/Right) of the most smiley face [0..1]
  readonly faceArea: number; // largest face bbox area fraction [0..1]
  readonly faceCx: number; // largest face bbox centre x [0..1] (0.5 = centred)
}

type Landmarker = {
  detect(image: ImageData): {
    faceBlendshapes: { categories: { categoryName: string; score: number }[] }[];
    faceLandmarks: { x: number; y: number }[][];
  };
  close(): void;
};

let landmarkerPromise: Promise<Landmarker | null> | null = null;

const loadLandmarker = async (): Promise<Landmarker | null> => {
  try {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const modelAssetPath = (await headOk("/mediapipe/models/face_landmarker.task"))
      ? "/mediapipe/models/face_landmarker.task"
      : "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
    const lm = await withMediapipeAsyncLogFilter(() =>
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          // Local-first: vendored path checked first; falls back to Google's CDN
          // so the feature works before `public/mediapipe/models` is populated.
          modelAssetPath,
        },
        runningMode: "IMAGE",
        numFaces: 4,
        outputFaceBlendshapes: true,
      }),
    );
    return lm as unknown as Landmarker;
  } catch {
    return null;
  }
};

const headOk = async (url: string): Promise<boolean> => {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
};

const getLandmarker = (): Promise<Landmarker | null> => {
  if (!landmarkerPromise) landmarkerPromise = loadLandmarker();
  return landmarkerPromise;
};

// MediaPipe's wasm emits its startup INFO lines ("Created TensorFlow Lite
// XNNPACK delegate…") through console.error, which Next's dev overlay surfaces
// as a red error. Filter exactly those lines for the synchronous detect scope.
const withMediapipeLogFilter = <T>(fn: () => T): T => {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("INFO: ")) return;
    original(...args);
  };
  try {
    return fn();
  } finally {
    console.error = original;
  }
};

// Model creation is asynchronous, and the delegate message is emitted before
// that promise settles. Keep the same narrowly scoped filter active for the
// actual initialization window so Next's development overlay stays quiet.
const withMediapipeAsyncLogFilter = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("INFO: ")) return;
    original(...args);
  };
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

export const scoreSmiles = async (
  images: readonly ImageData[],
): Promise<readonly SmileSample[] | null> => {
  const lm = await getLandmarker();
  if (!lm) return null;
  try {
    return withMediapipeLogFilter(() =>
      images.map((img) => {
        const res = lm.detect(img);
        let smile = 0;
        for (const face of res.faceBlendshapes ?? []) {
          let l = 0;
          let r = 0;
          for (const c of face.categories) {
            if (c.categoryName === "mouthSmileLeft") l = c.score;
            if (c.categoryName === "mouthSmileRight") r = c.score;
          }
          smile = Math.max(smile, (l + r) / 2);
        }
        let faceArea = 0;
        let faceCx = 0.5;
        for (const lms of res.faceLandmarks ?? []) {
          let minX = 1;
          let maxX = 0;
          let minY = 1;
          let maxY = 0;
          for (const p of lms) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
          }
          const area = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
          if (area > faceArea) {
            faceArea = area;
            faceCx = (minX + maxX) / 2;
          }
        }
        return { smile, faceArea, faceCx };
      }),
    );
  } catch {
    return null;
  }
};
