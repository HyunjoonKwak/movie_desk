import type { EffectDefinition } from "../types";

export const vignette: EffectDefinition = {
  type: "vignette",
  name: "Vignette",
  keywords: ["edge", "darken"],
  workingSpace: "linear",
  category: "stylize",
  params: [
    {
      kind: "number",
      key: "intensity",
      label: "Intensity",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
    {
      kind: "number",
      key: "softness",
      label: "Softness",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
  ],
  passes: [
    {
      shader: "vignette",
      uniforms: ({ params }) => ({
        u_intensity: Number(params.intensity ?? 0.5),
        u_softness: Number(params.softness ?? 0.5),
      }),
    },
  ],
};
