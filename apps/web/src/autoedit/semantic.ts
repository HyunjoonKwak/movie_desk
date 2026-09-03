// P5 — semantic scoring, dedup embeddings, and aesthetics via MobileCLIP
// (transformers.js). Contract: returns null whenever the model is unavailable
// OR the feature hasn't been explicitly enabled — the ~55MB download must be
// user-opted (wizard toggle), never triggered silently by import analysis.

export interface SemanticResult {
  readonly perSample: readonly number[]; // best prompt-bank similarity per frame [0..1]
  readonly embedding?: Float32Array; // bank-similarity vector of the best frame (dedup)
  readonly tags?: readonly string[]; // top matching prompt labels
  readonly aesthetic?: number; // aesthetic score [0..1]
}

// Travel/family prompt bank — labels double as semantic tags.
const PROMPT_BANK: readonly { label: string; text: string }[] = [
  { label: "sunset", text: "a beautiful sunset over the landscape" },
  { label: "beach", text: "a beach with waves and sand" },
  { label: "mountain", text: "a scenic mountain landscape" },
  { label: "smiling-family", text: "a happy smiling family together" },
  { label: "child", text: "a child playing and laughing" },
  { label: "food", text: "delicious food on a table" },
  { label: "city", text: "a city street with buildings" },
  { label: "nature", text: "a forest or waterfall in nature" },
  { label: "night", text: "night view with lights" },
];

type ZeroShotFn = (img: ImageData, labels: string[]) => Promise<{ scores: number[] }>;

// Semantic tagging stays off until a product decision wires a setting: it
// would download a zero-shot model. Nothing turns it on today; a failed
// model load turns it off for the session.
let enabled = false;
let pipePromise: Promise<ZeroShotFn | null> | null = null;
let failed = false;

export const isSemanticEnabled = (): boolean => enabled;

const loadZeroShot = async (): Promise<ZeroShotFn | null> => {
  if (failed) return null;
  try {
    const { pipeline, RawImage } = await import("@huggingface/transformers");
    const classifier = (await pipeline("zero-shot-image-classification", "Xenova/mobileclip_s0", {
      dtype: "q8",
    } as Record<string, unknown>)) as unknown as (
      img: unknown,
      labels: string[],
    ) => Promise<{ label: string; score: number }[]>;

    return async (img, labels) => {
      const raw = new RawImage(new Uint8ClampedArray(img.data), img.width, img.height, 4);
      const out = await classifier(raw, labels);
      const byLabel = new Map(out.map((o) => [o.label, o.score]));
      return { scores: labels.map((l) => byLabel.get(l) ?? 0) };
    };
  } catch {
    failed = true;
    return null;
  }
};

const getZeroShot = (): Promise<ZeroShotFn | null> => {
  if (!enabled) return Promise.resolve(null);
  if (!pipePromise) pipePromise = loadZeroShot();
  return pipePromise;
};

// Preload for the wizard toggle; resolves true when the model is ready.
export const enableSemantic = async (): Promise<boolean> => {
  enabled = true;
  return (await getZeroShot()) !== null;
};

export const semanticScore = async (
  images: readonly ImageData[],
): Promise<SemanticResult | null> => {
  const zeroShot = await getZeroShot();
  if (!zeroShot || images.length === 0) return null;
  try {
    const texts = PROMPT_BANK.map((p) => p.text);
    const perSample: number[] = [];
    let best = -1;
    let bestScores: number[] = [];
    for (const image of images) {
      const { scores } = await zeroShot(image, texts);
      const top = Math.max(...scores);
      perSample.push(top);
      if (top > best) {
        best = top;
        bestScores = scores;
      }
    }
    const tags = PROMPT_BANK.filter((_, i) => bestScores[i]! > 0.35).map((p) => p.label);
    // Bank-similarity vector doubles as a compact embedding for dedup.
    const embedding = Float32Array.from(bestScores);
    return { perSample, embedding, tags };
  } catch {
    return null;
  }
};

// Cosine similarity for dedup/diversity constraints (BEAT-style 0.8 cut).
export const cosine = (a: Float32Array, b: Float32Array): number => {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / Math.max(1e-9, Math.sqrt(na) * Math.sqrt(nb));
};
