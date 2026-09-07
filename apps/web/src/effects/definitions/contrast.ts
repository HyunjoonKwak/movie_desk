import type { EffectDefinition } from "../types";

export const contrast: EffectDefinition = {
  type: "contrast",
  name: "Contrast",
  keywords: ["color", "punch"],
  workingSpace: "encoded",
  category: "color",
  params: [
    { kind: "number", key: "amount", label: "Amount", min: -1, max: 1, step: 0.01, default: 0 },
  ],
  passes: [
    {
      shader: "contrast",
      uniforms: ({ params }) => ({ u_amount: Number(params.amount ?? 0) }),
    },
  ],
};
