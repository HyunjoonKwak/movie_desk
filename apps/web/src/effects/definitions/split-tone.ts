import type { EffectDefinition } from "../types";

const hexToRgb = (hex: string): readonly [number, number, number] => {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
  ] as const;
};

// Split toning: tint shadows and highlights toward separate colors, balanced
// by a midpoint. A staple of cinematic teal-and-orange looks.
export const splitTone: EffectDefinition = {
  type: "split-tone",
  name: "Split tone",
  keywords: ["teal orange", "shadows", "highlights", "grade", "tone"],
  workingSpace: "encoded",
  category: "color",
  params: [
    { kind: "color", key: "shadowColor", label: "Shadows", default: "#1e3a5f" },
    { kind: "color", key: "highlightColor", label: "Highlights", default: "#f5b971" },
    { kind: "number", key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 0.3 },
    { kind: "number", key: "balance", label: "Balance", min: -0.5, max: 0.5, step: 0.01, default: 0 },
  ],
  passes: [
    {
      shader: "split-tone",
      uniforms: ({ params }) => ({
        u_shadow: hexToRgb(String(params.shadowColor ?? "#1e3a5f")),
        u_highlight: hexToRgb(String(params.highlightColor ?? "#f5b971")),
        u_amount: Number(params.amount ?? 0.3),
        u_balance: Number(params.balance ?? 0),
      }),
    },
  ],
};
