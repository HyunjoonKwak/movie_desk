import type { ID, MediaAsset } from "@movie-desk/core";
import { Compositor } from "@/renderer/compositor";
import { useProjectStore } from "@/stores/project-store";

export interface WhiteBalanceResult {
  temperature: number;
  tint: number;
}

// Gray-world auto white balance: renders the current frame small, averages the
// channels, and derives temperature/tint corrections that neutralize the cast.
// The numbers are the inverse of the white-balance shader's channel mixing.
export const computeAutoWhiteBalance = async (): Promise<WhiteBalanceResult | null> => {
  const project = useProjectStore.getState().project;
  const assets = new Map(project.mediaLibrary.map((a) => [a.id, a]));
  const getAsset = (id: ID): MediaAsset | undefined => assets.get(id);

  const W = 160;
  const aspect = project.resolution.h / project.resolution.w || 0.5625;
  const H = Math.max(2, Math.round(W * aspect));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const compositor = new Compositor(canvas);
  try {
    compositor.resize(W, H);
    const at = project.timeline.playhead;
    compositor.setPlayheadGetter(() => at);
    await compositor.renderFrame(project, getAsset);
    await compositor.renderFrame(project, getAsset);

    const read = document.createElement("canvas");
    read.width = W;
    read.height = H;
    const ctx = read.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, W, H);

    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]!;
      if (a < 8) continue; // skip transparent regions
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
    if (n === 0) return null;
    r = r / n / 255;
    g = g / n / 255;
    b = b / n / 255;
    const avg = (r + g + b) / 3;

    // Channel deltas needed to reach neutral gray.
    const dr = avg - r;
    const dg = avg - g;
    const db = avg - b;
    // Invert the shader mix: temp moves r up / b down (±0.15); tint moves g (∓0.15).
    const temperature = Math.max(-1, Math.min(1, (dr - db) / (2 * 0.15)));
    const tint = Math.max(-1, Math.min(1, -dg / 0.15));
    return { temperature, tint };
  } finally {
    compositor.dispose();
  }
};
