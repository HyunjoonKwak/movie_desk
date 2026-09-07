// Scene-linear Rec.709 / D65. Alpha is coverage, never a transfer-encoded signal.
export type ColorDomain = "linear" | "srgb" | "bt709";
export const decodeTransfer = (value: number, domain: ColorDomain): number => {
  if (domain === "linear") return value;
  if (domain === "bt709")
    return value < 0.081 ? value / 4.5 : ((value + 0.099) / 1.099) ** (1 / 0.45);
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
export const encodeTransfer = (value: number, domain: ColorDomain): number => {
  if (domain === "linear") return value;
  if (domain === "bt709") return value < 0.018 ? value * 4.5 : 1.099 * value ** 0.45 - 0.099;
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
};
export const domainIndex = (domain: ColorDomain): number =>
  ["linear", "srgb", "bt709"].indexOf(domain);
export const lutDomain = (value: unknown): ColorDomain => {
  if (value === undefined || value === "srgb") return "srgb";
  if (value === "bt709" || value === "linear") return value;
  throw new Error(`Unsupported LUT color space: ${String(value)}`);
};
export const TRANSFER_GLSL = /* glsl */ `
vec3 decodeColor(vec3 x, int domain) {
  if (domain == 0) return x;
  if (domain == 2) return mix(x / 4.5, pow(max((x + 0.099) / 1.099, 0.0), vec3(1.0 / 0.45)), step(vec3(0.081), x));
  return mix(x / 12.92, pow(max((x + 0.055) / 1.055, 0.0), vec3(2.4)), step(vec3(0.04045), x));
}
vec3 encodeColor(vec3 x, int domain) {
  if (domain == 0) return x;
  if (domain == 2) return mix(x * 4.5, 1.099 * pow(max(x, 0.0), vec3(0.45)) - 0.099, step(vec3(0.018), x));
  return mix(x * 12.92, 1.055 * pow(max(x, 0.0), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), x));
}
`;
