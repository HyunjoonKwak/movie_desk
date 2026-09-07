// Pure scope computations over an RGBA pixel buffer. Kept framework-free so
// they can run in a worker later. All outputs are small typed arrays ready
// to paint onto a scope canvas.

export interface Histogram {
  readonly r: Uint32Array; // 256 bins
  readonly g: Uint32Array;
  readonly b: Uint32Array;
  readonly luma: Uint32Array;
  readonly max: number; // tallest bin, for normalization
}

export const computeHistogram = (pixels: Uint8ClampedArray): Histogram => {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const luma = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) {
    const rv = pixels[i]!;
    const gv = pixels[i + 1]!;
    const bv = pixels[i + 2]!;
    r[rv]!++;
    g[gv]!++;
    b[bv]!++;
    luma[Math.round(rv * 0.2126 + gv * 0.7152 + bv * 0.0722)]!++;
  }
  let max = 0;
  for (let i = 0; i < 256; i++) {
    max = Math.max(max, r[i]!, g[i]!, b[i]!, luma[i]!);
  }
  return { r, g, b, luma, max: Math.max(1, max) };
};

// Luma waveform: for each output column, a 256-row brightness distribution.
// Returns a `cols × 256` intensity map (0..255) for additive plotting.
export const computeLumaWaveform = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cols = 256,
): { map: Uint8ClampedArray; cols: number } => {
  const map = new Uint8ClampedArray(cols * 256);
  const colStep = width / cols;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = Math.round(
        pixels[i]! * 0.2126 + pixels[i + 1]! * 0.7152 + pixels[i + 2]! * 0.0722,
      );
      const col = Math.min(cols - 1, Math.floor(x / colStep));
      const idx = (255 - lum) * cols + col;
      map[idx] = Math.min(255, map[idx]! + 16);
    }
  }
  return { map, cols };
};

// Vectorscope: U/V chroma scatter. Returns accumulation grid `size × size`.
export const computeVectorscope = (pixels: Uint8ClampedArray, size = 256): Uint8ClampedArray => {
  const grid = new Uint8ClampedArray(size * size);
  const half = size / 2;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]! / 255;
    const g = pixels[i + 1]! / 255;
    const b = pixels[i + 2]! / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const u = (b - y) / 1.8556;
    const v = (r - y) / 1.5748;
    const px = Math.round(half + u * half);
    const py = Math.round(half - v * half);
    if (px >= 0 && px < size && py >= 0 && py < size) {
      const idx = py * size + px;
      grid[idx] = Math.min(255, grid[idx]! + 24);
    }
  }
  return grid;
};

export const computeParade = (pixels: Uint8ClampedArray, width: number, height: number) => {
  const cols = width * 3;
  const map = new Uint8ClampedArray(cols * 256);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const idx = (255 - pixels[(y * width + x) * 4 + c]!) * cols + c * width + x;
        map[idx] = Math.min(255, map[idx]! + 16);
      }
    }
  return { map, cols };
};

export const clipping = (pixels: Uint8ClampedArray) => {
  let low = 0;
  let high = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) <= 1) low++;
    if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) >= 254) high++;
  }
  return { low, high, samples: pixels.length / 4 };
};

export const sampleSize = (width: number, height: number) => {
  const ratio = Math.min(1, 256 / Math.max(1, width), 144 / Math.max(1, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
};
