import type { EffectDefinition } from "./types";
import { brightness } from "./definitions/brightness";
import { contrast } from "./definitions/contrast";
import { saturation } from "./definitions/saturation";
import { hue } from "./definitions/hue";
import { exposure } from "./definitions/exposure";
import { gaussianBlur } from "./definitions/gaussian-blur";
import { sharpen } from "./definitions/sharpen";
import { vignette } from "./definitions/vignette";
import { sepia } from "./definitions/sepia";
import { invert } from "./definitions/invert";
import { grain } from "./definitions/grain";
import { chromaKey } from "./definitions/chroma-key";
import { bgRemove } from "./definitions/bg-remove";
import { audioGain } from "./definitions/audio-gain";
import { audioFade } from "./definitions/audio-fade";
import { audioEq } from "./definitions/audio-eq";
import { audioNoiseGate } from "./definitions/audio-noise-gate";
import { audioSpectralDenoise } from "./definitions/audio-spectral-denoise";
import { lut } from "./definitions/lut";
import { colorWheels } from "./definitions/color-wheels";
import { whiteBalance } from "./definitions/white-balance";
import { levels } from "./definitions/levels";
import { vibrance } from "./definitions/vibrance";
import { splitTone } from "./definitions/split-tone";

const builtin: readonly EffectDefinition[] = [
  // Color
  brightness,
  contrast,
  exposure,
  saturation,
  hue,
  lut,
  colorWheels,
  whiteBalance,
  levels,
  vibrance,
  splitTone,
  // Blur
  gaussianBlur,
  // Stylize
  sharpen,
  vignette,
  sepia,
  invert,
  grain,
  chromaKey,
  bgRemove,
  // Audio
  audioGain,
  audioFade,
  audioEq,
  audioNoiseGate,
  audioSpectralDenoise,
];

export const listEffects = (): readonly EffectDefinition[] => builtin;
export const getEffect = (type: string): EffectDefinition | undefined =>
  builtin.find((e) => e.type === type);
