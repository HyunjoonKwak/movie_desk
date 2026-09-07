import type { EffectDefinition } from "../types";

export const sharpen: EffectDefinition = {
  type: "sharpen",
  name: "Sharpen",
  keywords: ["detail", "unsharp"],
  workingSpace: "linear",
  category: "stylize",
  params: [
    { kind: "number", key: "amount", label: "Amount", min: 0, max: 2, step: 0.05, default: 0.5 },
  ],
  passes: [
    {
      shader: "sharpen",
      uniforms: ({ params }) => ({ u_amount: Number(params.amount ?? 0.5) }),
    },
  ],
};
