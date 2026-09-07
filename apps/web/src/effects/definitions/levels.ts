import type { EffectDefinition } from "../types";

// Levels: remap input black/white points and apply a midtone gamma, like the
// classic histogram levels control.
export const levels: EffectDefinition = {
  type: "levels",
  name: "Levels",
  keywords: ["black point", "white point", "gamma", "contrast", "histogram"],
  workingSpace: "encoded",
  category: "color",
  params: [
    { kind: "number", key: "black", label: "Black point", min: 0, max: 0.5, step: 0.01, default: 0 },
    { kind: "number", key: "white", label: "White point", min: 0.5, max: 1, step: 0.01, default: 1 },
    { kind: "number", key: "gamma", label: "Gamma", min: 0.2, max: 3, step: 0.01, default: 1 },
  ],
  passes: [
    {
      shader: "levels",
      uniforms: ({ params }) => ({
        u_black: Number(params.black ?? 0),
        u_white: Number(params.white ?? 1),
        u_gamma: Number(params.gamma ?? 1),
      }),
    },
  ],
};
