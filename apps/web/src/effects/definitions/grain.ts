import type { EffectDefinition } from "../types";

export const grain: EffectDefinition = {
  type: "grain",
  name: "Film grain",
  keywords: ["noise", "film", "texture"],
  workingSpace: "linear",
  category: "stylize",
  params: [
    { kind: "number", key: "amount", label: "Amount", min: 0, max: 0.5, step: 0.01, default: 0.1 },
  ],
  passes: [
    {
      shader: "grain",
      uniforms: ({ params }) => ({
        u_amount: Number(params.amount ?? 0.1),
        u_time: (performance.now() / 1000) % 1000,
      }),
    },
  ],
};
