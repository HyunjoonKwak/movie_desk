import type { EffectDefinition } from "../types";

// 3-way color corrector: lift (shadows), gamma (midtones), gain (highlights).
// Each is an RGB offset/multiplier centered at 0 (neutral). The shader maps
// these to the classic lift/gamma/gain transfer.
export const colorWheels: EffectDefinition = {
  type: "color-wheels",
  name: "Color wheels (3-way)",
  keywords: ["grade", "lift", "gamma", "gain", "shadows", "highlights"],
  workingSpace: "linear",
  category: "color",
  params: [
    { kind: "number", key: "liftR", label: "Lift R", min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { kind: "number", key: "liftG", label: "Lift G", min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { kind: "number", key: "liftB", label: "Lift B", min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { kind: "number", key: "gammaR", label: "Gamma R", min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { kind: "number", key: "gammaG", label: "Gamma G", min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { kind: "number", key: "gammaB", label: "Gamma B", min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { kind: "number", key: "gainR", label: "Gain R", min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { kind: "number", key: "gainG", label: "Gain G", min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { kind: "number", key: "gainB", label: "Gain B", min: -0.5, max: 0.5, step: 0.01, default: 0 },
  ],
  passes: [
    {
      shader: "color-wheels",
      uniforms: ({ params }) => ({
        u_lift: [Number(params.liftR ?? 0), Number(params.liftG ?? 0), Number(params.liftB ?? 0)] as const,
        u_gamma: [Number(params.gammaR ?? 0), Number(params.gammaG ?? 0), Number(params.gammaB ?? 0)] as const,
        u_gain: [Number(params.gainR ?? 0), Number(params.gainG ?? 0), Number(params.gainB ?? 0)] as const,
      }),
    },
  ],
};
