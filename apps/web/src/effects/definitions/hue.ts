import type { EffectDefinition } from "../types";

export const hue: EffectDefinition = {
  type: "hue",
  name: "Hue rotate",
  keywords: ["color", "tint"],
  workingSpace: "encoded",
  category: "color",
  params: [
    { kind: "number", key: "degrees", label: "Degrees", min: -180, max: 180, step: 1, default: 0 },
  ],
  passes: [
    {
      shader: "hue",
      uniforms: ({ params }) => ({ u_degrees: Number(params.degrees ?? 0) }),
    },
  ],
};
