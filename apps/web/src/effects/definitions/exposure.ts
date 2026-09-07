import type { EffectDefinition } from "../types";

export const exposure: EffectDefinition = {
  type: "exposure",
  name: "Exposure",
  keywords: ["light", "stops"],
  workingSpace: "linear",
  category: "color",
  params: [
    { kind: "number", key: "stops", label: "Stops", min: -3, max: 3, step: 0.05, default: 0 },
  ],
  passes: [
    {
      shader: "exposure",
      uniforms: ({ params }) => ({ u_stops: Number(params.stops ?? 0) }),
    },
  ],
};
