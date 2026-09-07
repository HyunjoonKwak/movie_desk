import type { EffectDefinition } from "../types";

// White balance via temperature (blue↔amber) and tint (green↔magenta) shifts.
export const whiteBalance: EffectDefinition = {
  type: "white-balance",
  name: "White balance",
  keywords: ["temperature", "tint", "color", "warm", "cool"],
  workingSpace: "linear",
  category: "color",
  params: [
    { kind: "number", key: "temperature", label: "Temperature", min: -1, max: 1, step: 0.01, default: 0 },
    { kind: "number", key: "tint", label: "Tint", min: -1, max: 1, step: 0.01, default: 0 },
  ],
  passes: [
    {
      shader: "white-balance",
      uniforms: ({ params }) => ({
        u_temp: Number(params.temperature ?? 0),
        u_tint: Number(params.tint ?? 0),
      }),
    },
  ],
};
