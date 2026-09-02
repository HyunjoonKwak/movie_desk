import type { EffectDefinition } from "../types";

// LUT effect — the actual 1D/3D texture upload happens in the compositor.
// `intensity` blends the LUT-mapped colour with the original.
// `lutId` is a stored LUT id (see lut-store); the compositor reads its raw
// `.cube` text, parses it, and uploads the data into a 2D RGB texture on
// demand. We expose `lutId` as a string param so scripting can
// still set it programmatically; the inspector UI will get its own picker.
export const lut: EffectDefinition = {
  type: "lut",
  name: "LUT (.cube)",
  keywords: ["look", "grade", "filter"],
  category: "color",
  params: [
    { kind: "number", key: "intensity", label: "Intensity", min: 0, max: 1, step: 0.01, default: 1 },
    {
      kind: "enum",
      key: "lutId",
      label: "LUT",
      options: [],            // populated dynamically by the UI
      default: "",
    },
  ],
  passes: [
    {
      shader: "lut",
      uniforms: ({ params }) => ({
        u_intensity: Number(params.intensity ?? 1),
        // u_lut_size and u_lut_tex are set out-of-band by the compositor.
      }),
    },
  ],
};
