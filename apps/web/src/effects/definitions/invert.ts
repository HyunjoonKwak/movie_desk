import type { EffectDefinition } from "../types";

export const invert: EffectDefinition = {
  type: "invert",
  name: "Invert",
  keywords: ["negative", "color"],
  workingSpace: "encoded",
  category: "stylize",
  params: [
    { kind: "number", key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 1 },
  ],
  passes: [
    {
      shader: "invert",
      uniforms: ({ params }) => ({ u_amount: Number(params.amount ?? 1) }),
    },
  ],
};
