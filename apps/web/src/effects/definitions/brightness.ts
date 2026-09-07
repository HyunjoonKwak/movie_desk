import type { EffectDefinition } from "../types";

export const brightness: EffectDefinition = {
  type: "brightness",
  name: "Brightness",
  keywords: ["light", "exposure"],
  workingSpace: "encoded",
  category: "color",
  params: [
    {
      kind: "number",
      key: "amount",
      label: "Amount",
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
  ],
  passes: [
    {
      shader: "brightness",
      uniforms: ({ params }) => ({
        u_amount: Number(params.amount ?? 0),
      }),
    },
  ],
};
