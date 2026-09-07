import type { EffectDefinition } from "../types";

export const gaussianBlur: EffectDefinition = {
  type: "gaussian-blur",
  name: "Gaussian Blur",
  keywords: ["blur", "soft"],
  workingSpace: "linear",
  category: "blur",
  params: [
    {
      kind: "number",
      key: "sigma",
      label: "Sigma",
      min: 0,
      max: 20,
      step: 0.1,
      default: 4,
    },
  ],
  // Horizontal then vertical pass — same pattern as OpenCut.
  passes: [
    {
      shader: "gaussian-blur",
      uniforms: ({ params, width }) => ({
        u_direction: [1, 0] as const,
        u_sigma: Number(params.sigma ?? 4),
        u_resolution: width,
      }),
    },
    {
      shader: "gaussian-blur",
      uniforms: ({ params, height }) => ({
        u_direction: [0, 1] as const,
        u_sigma: Number(params.sigma ?? 4),
        u_resolution: height,
      }),
    },
  ],
};
