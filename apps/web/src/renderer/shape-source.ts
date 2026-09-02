import type { ShapeClip } from "@movie-desk/core";

// Renders a shape clip to an offscreen canvas at project resolution. Cached
// by a content hash so we only repaint when the shape definition changes.
const cache = new Map<string, HTMLCanvasElement>();

const keyFor = (clip: ShapeClip, w: number, h: number) =>
  `${clip.id}|${clip.shape}|${clip.fill}|${clip.stroke}|${clip.strokeWidth}|${clip.cornerRadius ?? 0}|${clip.fillType ?? "solid"}|${clip.fillColor2 ?? "_"}|${clip.gradientAngle ?? 0}|${w}x${h}`;

export const renderShapeToCanvas = (
  clip: ShapeClip,
  width: number,
  height: number,
): HTMLCanvasElement => {
  const key = keyFor(clip, width, height);
  const cached = cache.get(key);
  if (cached) return cached;

  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.clearRect(0, 0, width, height);

  // Shape occupies the centered 60% box; transform handles further scaling.
  const bw = width * 0.6;
  const bh = height * 0.6;
  const x = (width - bw) / 2;
  const y = (height - bh) / 2;

  const fillType = clip.fillType ?? "solid";
  if (fillType === "linear" && clip.fillColor2) {
    const angle = ((clip.gradientAngle ?? 0) * Math.PI) / 180;
    const cx = x + bw / 2;
    const cy = y + bh / 2;
    const r = Math.max(bw, bh) / 2;
    const grad = ctx.createLinearGradient(
      cx - Math.cos(angle) * r,
      cy - Math.sin(angle) * r,
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r,
    );
    grad.addColorStop(0, clip.fill);
    grad.addColorStop(1, clip.fillColor2);
    ctx.fillStyle = grad;
  } else if (fillType === "radial" && clip.fillColor2) {
    const grad = ctx.createRadialGradient(
      x + bw / 2,
      y + bh / 2,
      0,
      x + bw / 2,
      y + bh / 2,
      Math.max(bw, bh) / 2,
    );
    grad.addColorStop(0, clip.fill);
    grad.addColorStop(1, clip.fillColor2);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = clip.fill;
  }
  ctx.strokeStyle = clip.stroke;
  ctx.lineWidth = clip.strokeWidth;

  const hasFill = clip.fill !== "transparent" && clip.fill !== "";
  const hasStroke = clip.strokeWidth > 0;

  if (clip.shape === "rect") {
    const r = Math.min(clip.cornerRadius ?? 0, bw / 2, bh / 2);
    ctx.beginPath();
    if (r > 0) {
      ctx.roundRect(x, y, bw, bh, r);
    } else {
      ctx.rect(x, y, bw, bh);
    }
    if (hasFill) ctx.fill();
    if (hasStroke) ctx.stroke();
  } else if (clip.shape === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(width / 2, height / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    if (hasFill) ctx.fill();
    if (hasStroke) ctx.stroke();
  } else {
    // line: diagonal across the box
    ctx.beginPath();
    ctx.moveTo(x, y + bh);
    ctx.lineTo(x + bw, y);
    if (hasStroke) ctx.stroke();
  }

  if (cache.size > 32) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, c);
  return c;
};
