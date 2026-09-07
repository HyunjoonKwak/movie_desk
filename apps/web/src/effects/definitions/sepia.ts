import type { EffectDefinition } from "../types";

export const sepia: EffectDefinition = {
  type: "sepia",
  name: "Sepia",
  keywords: ["color", "vintage", "warm"],
  workingSpace: "encoded",
  category: "stylize",
  params: [
    { kind: "number", key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 1 },
  ],
  passes: [
    {
      shader: "sepia",
      uniforms: ({ params }) => ({ u_amount: Number(params.amount ?? 1) }),
    },
  ],
};
