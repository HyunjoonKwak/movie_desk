import type { EffectDefinition } from "../types";

// The actual mask is computed CPU-side by MediaPipe and uploaded as an
// extra texture (`u_mask`) by the compositor when it sees this effect.
// The shader simply multiplies alpha by the mask intensity.
export const bgRemove: EffectDefinition = {
  type: "bg-remove",
  name: "Background removal",
  keywords: ["green screen", "person", "mask", "segmentation"],
  workingSpace: "linear",
  category: "stylize",
  params: [
    {
      kind: "number",
      key: "feather",
      label: "Feather",
      min: 0,
      max: 0.2,
      step: 0.01,
      default: 0.05,
    },
  ],
  passes: [
    {
      shader: "bg-remove",
      uniforms: ({ params }) => ({
        u_feather: Number(params.feather ?? 0.05),
      }),
    },
  ],
};
