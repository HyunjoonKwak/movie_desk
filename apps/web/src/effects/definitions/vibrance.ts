import type { EffectDefinition } from "../types";

// Vibrance: boosts saturation more on muted colors and less on already-
// saturated ones, protecting skin tones better than a flat saturation lift.
export const vibrance: EffectDefinition = {
  type: "vibrance",
  name: "Vibrance",
  keywords: ["saturation", "color", "pop"],
  workingSpace: "encoded",
  category: "color",
  params: [
    { kind: "number", key: "amount", label: "Amount", min: -1, max: 1, step: 0.01, default: 0 },
  ],
  passes: [
    {
      shader: "vibrance",
      uniforms: ({ params }) => ({ u_amount: Number(params.amount ?? 0) }),
    },
  ],
};
