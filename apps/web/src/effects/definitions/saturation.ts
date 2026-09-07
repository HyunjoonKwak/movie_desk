import type { EffectDefinition } from "../types";

export const saturation: EffectDefinition = {
  type: "saturation",
  name: "Saturation",
  keywords: ["color", "vibrance"],
  workingSpace: "encoded",
  category: "color",
  params: [
    { kind: "number", key: "amount", label: "Amount", min: -1, max: 1, step: 0.01, default: 0 },
  ],
  passes: [
    {
      shader: "saturation",
      uniforms: ({ params }) => ({ u_amount: Number(params.amount ?? 0) }),
    },
  ],
};
