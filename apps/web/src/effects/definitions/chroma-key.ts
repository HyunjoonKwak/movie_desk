import type { EffectDefinition } from "../types";

// Green-screen / chroma key. `keyColor` is the colour that becomes transparent;
// `similarity` widens the matched hue range; `smoothness` softens the edge.
export const chromaKey: EffectDefinition = {
  type: "chroma-key",
  name: "Chroma key",
  keywords: ["green screen", "blue screen", "key", "transparency"],
  workingSpace: "encoded",
  category: "stylize",
  params: [
    { kind: "color", key: "keyColor", label: "Key color", default: "#00ff00" },
    { kind: "number", key: "similarity", label: "Similarity", min: 0, max: 1, step: 0.01, default: 0.4 },
    { kind: "number", key: "smoothness", label: "Smoothness", min: 0, max: 0.5, step: 0.01, default: 0.1 },
    { kind: "number", key: "spill", label: "Spill", min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  passes: [
    {
      shader: "chroma-key",
      uniforms: ({ params }) => {
        const hex = String(params.keyColor ?? "#00ff00").replace("#", "");
        const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
        const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
        const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
        return {
          u_key_color: [r, g, b] as const,
          u_similarity: Number(params.similarity ?? 0.4),
          u_smoothness: Number(params.smoothness ?? 0.1),
          u_spill: Number(params.spill ?? 0.5),
        };
      },
    },
  ],
};
