import {
  computeHistogram,
  computeLumaWaveform,
  computeParade,
  computeVectorscope,
} from "./compute";
export type ScopeKind = "histogram" | "luma" | "waveform" | "parade" | "vectorscope";
let scratch: OffscreenCanvas | undefined;
const scratchCanvas = (width: number, height: number) => {
  scratch ??= new OffscreenCanvas(width, height);
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  return scratch;
};
export function paintScope(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  kind: ScopeKind,
  px: Uint8ClampedArray,
  sw: number,
  sh: number,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  if (kind === "histogram" || kind === "luma") {
    const hist = computeHistogram(px);
    const drawChannel = (bins: Uint32Array, color: string) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * (w - 1);
        const y = h - 1 - (bins[i]! / hist.max) * (h - 1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    ctx.globalCompositeOperation = "lighter";
    if (kind === "luma") drawChannel(hist.luma, "white");
    else {
      drawChannel(hist.r, "rgba(255,80,80,0.8)");
      drawChannel(hist.g, "rgba(80,255,80,0.8)");
      drawChannel(hist.b, "rgba(80,120,255,0.8)");
    }
    ctx.globalCompositeOperation = "source-over";
    return;
  }

  if (kind === "waveform" || kind === "parade") {
    const { map, cols } =
      kind === "parade"
        ? computeParade(px, sw, sh)
        : computeLumaWaveform(px, sw, sh, Math.min(256, sw));
    const img = ctx.createImageData(cols, 256);
    for (let i = 0; i < cols * 256; i++) {
      const v = map[i]!;
      const channel = Math.floor((i % cols) / sw);
      img.data[i * 4] = kind !== "parade" || channel === 0 ? v : 0;
      img.data[i * 4 + 1] = kind !== "parade" || channel === 1 ? v : 0;
      img.data[i * 4 + 2] = kind !== "parade" || channel === 2 ? v : 0;
      img.data[i * 4 + 3] = 255;
    }
    const tmp = scratchCanvas(cols, 256);
    tmp.getContext("2d")!.putImageData(img, 0, 0);
    ctx.drawImage(tmp, 0, 0, w, h);
    return;
  }

  // vectorscope
  const size = 256;
  const grid = computeVectorscope(px, size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = grid[i]!;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  const tmp = scratchCanvas(size, size);
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  const sq = Math.min(w, h);
  ctx.drawImage(tmp, (w - sq) / 2, (h - sq) / 2, sq, sq);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, sq / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = "9px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  for (const [label, r, g, b] of [
    ["R", 1, 0, 0],
    ["Y", 1, 1, 0],
    ["G", 0, 1, 0],
    ["C", 0, 1, 1],
    ["B", 0, 0, 1],
    ["M", 1, 0, 1],
  ] as const) {
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const x = w / 2 + ((b - y) / 1.8556) * sq;
    const v = h / 2 - ((r - y) / 1.5748) * sq;
    ctx.strokeRect(x - 2, v - 2, 4, 4);
    ctx.fillText(label, Math.min(w - 10, Math.max(2, x + 4)), Math.min(h - 2, Math.max(10, v)));
  }
}
