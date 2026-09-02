import { VS_QUAD } from "./shaders/vertex";
import { linkProgram, type GL } from "./gl";

import { fs as blitFs } from "./shaders/blit";
import { fs as brightnessFs } from "./shaders/brightness";
import { fs as contrastFs } from "./shaders/contrast";
import { fs as exposureFs } from "./shaders/exposure";
import { fs as saturationFs } from "./shaders/saturation";
import { fs as hueFs } from "./shaders/hue";
import { fs as gaussianBlurFs } from "./shaders/gaussian-blur";
import { fs as sharpenFs } from "./shaders/sharpen";
import { fs as vignetteFs } from "./shaders/vignette";
import { fs as sepiaFs } from "./shaders/sepia";
import { fs as invertFs } from "./shaders/invert";
import { fs as grainFs } from "./shaders/grain";
import { fs as chromaKeyFs } from "./shaders/chroma-key";
import { fs as bgRemoveFs } from "./shaders/bg-remove";
import { fs as lutFs } from "./shaders/lut";
import { fs as colorWheelsFs } from "./shaders/color-wheels";
import { fs as whiteBalanceFs } from "./shaders/white-balance";
import { fs as levelsFs } from "./shaders/levels";
import { fs as vibranceFs } from "./shaders/vibrance";
import { fs as splitToneFs } from "./shaders/split-tone";
import { fs as blendModesFs } from "./shaders/blend-modes";
import { fs as fitFs } from "./shaders/fit";
import { fs as rotateFs } from "./shaders/rotate";

// Built-in fragment shaders. Each name maps to the GLSL source from a single
// dedicated file under shaders/.
const SHADERS: Readonly<Record<string, string>> = {
  blit: blitFs,
  brightness: brightnessFs,
  contrast: contrastFs,
  exposure: exposureFs,
  saturation: saturationFs,
  hue: hueFs,
  "gaussian-blur": gaussianBlurFs,
  sharpen: sharpenFs,
  vignette: vignetteFs,
  sepia: sepiaFs,
  invert: invertFs,
  grain: grainFs,
  "chroma-key": chromaKeyFs,
  "bg-remove": bgRemoveFs,
  lut: lutFs,
  "color-wheels": colorWheelsFs,
  "white-balance": whiteBalanceFs,
  levels: levelsFs,
  vibrance: vibranceFs,
  "split-tone": splitToneFs,
  "blend-modes": blendModesFs,
  fit: fitFs,
  rotate: rotateFs,
};

// Thin wrapper around a linked WebGLProgram that memoises uniform locations.
// `gl.getUniformLocation` is a string-keyed lookup hit dozens of times per
// frame in the render loop; caching turns the hot path into a Map.get.
export class Program {
  // null entries are remembered too so missing uniforms aren't re-looked-up.
  private readonly locs = new Map<string, WebGLUniformLocation | null>();
  constructor(
    private readonly gl: GL,
    readonly handle: WebGLProgram,
  ) {}
  use(): void {
    this.gl.useProgram(this.handle);
  }
  uniform(name: string): WebGLUniformLocation | null {
    const cached = this.locs.get(name);
    if (cached !== undefined) return cached;
    const loc = this.gl.getUniformLocation(this.handle, name);
    this.locs.set(name, loc);
    return loc;
  }
}

export class ShaderRegistry {
  private readonly cache = new Map<string, Program>();
  constructor(private readonly gl: GL) {}

  get(name: string): Program {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const fs = SHADERS[name];
    if (!fs) throw new Error(`Unknown shader: ${name}`);
    const handle = linkProgram(this.gl, VS_QUAD, fs);
    const prog = new Program(this.gl, handle);
    this.cache.set(name, prog);
    return prog;
  }

  dispose() {
    for (const p of this.cache.values()) this.gl.deleteProgram(p.handle);
    this.cache.clear();
  }
}
