import { readTargetPixels } from "@/renderer/read-target";
import type { RenderTarget } from "@/renderer/render-target";
import { decodeTransfer, encodeTransfer } from "@/renderer/color";

export const BT709_COLOR_SPACE: VideoColorSpaceInit = {
  primaries: "bt709",
  transfer: "bt709",
  matrix: "bt709",
  fullRange: false,
};
const encoded709 = Float64Array.from({ length: 256 }, (_, i) =>
  encodeTransfer(decodeTransfer(i / 255, "srgb"), "bt709"),
);

// Full-range sRGB RGBA -> limited-range BT.709 I420. Input comes from the
// compositor's opaque presentation boundary. Chroma is a 2x2 encoded-RGB box
// average; converting tags alone would leave the browser's BT.601 matrix intact.
export const rgbaToBt709I420 = (
  rgba: Uint8Array,
  width: number,
  height: number,
  output: Uint8Array = new Uint8Array((width * height * 3) / 2),
  bottomUp = false,
): Uint8Array => {
  if (
    width % 2 ||
    height % 2 ||
    rgba.length !== width * height * 4 ||
    output.length !== (width * height * 3) / 2
  ) {
    throw new Error("BT.709 I420 requires even dimensions and complete RGBA planes");
  }
  const size = width * height;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      let sumR = 0;
      let sumB = 0;
      let sumY = 0;
      for (let dy = 0; dy < 2; dy++) {
        const inputY = bottomUp ? height - 1 - y - dy : y + dy;
        for (let dx = 0; dx < 2; dx++) {
          const i = (inputY * width + x + dx) * 4;
          const r = encoded709[rgba[i]!]!;
          const g = encoded709[rgba[i + 1]!]!;
          const b = encoded709[rgba[i + 2]!]!;
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          output[(y + dy) * width + x + dx] = Math.round(16 + 219 * luma);
          sumR += r;
          sumB += b;
          sumY += luma;
        }
      }
      const chroma = (y / 2) * (width / 2) + x / 2;
      output[size + chroma] = Math.round(128 + (224 * (sumB - sumY)) / (4 * 1.8556));
      output[(size * 5) / 4 + chroma] = Math.round(128 + (224 * (sumR - sumY)) / (4 * 1.5748));
    }
  }
  return output;
};

export class Bt709FrameCapture {
  private readonly rgba: Uint8Array;
  private readonly yuv: Uint8Array;
  constructor(private readonly canvas: HTMLCanvasElement) {
    this.rgba = new Uint8Array(canvas.width * canvas.height * 4);
    this.yuv = new Uint8Array((canvas.width * canvas.height * 3) / 2);
  }
  capture(timestamp: number, duration: number, target?: RenderTarget): VideoFrame {
    const { width, height } = this.canvas;
    const gl = this.canvas.getContext("webgl2");
    if (!gl || gl.isContextLost()) throw new Error("Export color readback is unavailable");
    readTargetPixels(gl, width, height, this.rgba, target);
    rgbaToBt709I420(this.rgba, width, height, this.yuv, true);
    return new VideoFrame(this.yuv, {
      format: "I420",
      codedWidth: width,
      codedHeight: height,
      timestamp,
      duration,
      colorSpace: BT709_COLOR_SPACE,
    });
  }
}

export const isBt709Output = (color: VideoColorSpaceInit | undefined): boolean =>
  color?.primaries === "bt709" &&
  color.transfer === "bt709" &&
  color.matrix === "bt709" &&
  color.fullRange === false;

// Null fields are Chrome's other representation of missing encoder VUI.
export const hasConflictingBt709Output = (color: VideoColorSpaceInit): boolean =>
  (Object.keys(BT709_COLOR_SPACE) as (keyof VideoColorSpaceInit)[]).some(
    (key) => color[key] != null && color[key] !== BT709_COLOR_SPACE[key],
  );
