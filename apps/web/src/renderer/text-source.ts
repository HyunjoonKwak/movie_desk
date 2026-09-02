import type { TextClip } from "@movie-desk/core";

// Off-screen canvas cache keyed by a content hash. Text clips re-render
// only when text/font/size/color (or the typewriter char count) changes.
const cache = new Map<string, HTMLCanvasElement>();

const keyFor = (clip: TextClip, width: number, height: number, shownChars: number) =>
  `${clip.id}|${clip.text.slice(0, shownChars)}|${clip.font}|${clip.size}|${clip.color}|${clip.bgColor ?? "_"}|${clip.weight ?? 400}|${clip.align ?? "center"}|${clip.strokeColor ?? "_"}|${clip.strokeWidth ?? 0}|${clip.shadow === false ? 0 : 1}|${clip.shadowBlur ?? -1}|${clip.shadowColor ?? "_"}|${width}x${height}`;

// `charFrac` (0..1) supports the typewriter animation by only drawing a
// prefix of the text. Defaults to 1 (full text).
export const renderTextToCanvas = (
  clip: TextClip,
  width: number,
  height: number,
  charFrac = 1,
): HTMLCanvasElement => {
  const shownChars = Math.max(0, Math.ceil(clip.text.length * Math.max(0, Math.min(1, charFrac))));
  const key = keyFor(clip, width, height, shownChars);
  const cached = cache.get(key);
  if (cached) return cached;

  const visibleText = clip.text.slice(0, shownChars);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  if (clip.bgColor) {
    ctx.fillStyle = clip.bgColor;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }
  const weight = clip.weight ?? 400;
  ctx.font = `${weight} ${clip.size}px ${clip.font}`;
  ctx.fillStyle = clip.color;
  const align = clip.align ?? "center";
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  // Drop shadow (on by default). Disabled when clip.shadow === false.
  if (clip.shadow !== false) {
    ctx.shadowColor = clip.shadowColor ?? "rgba(0,0,0,0.6)";
    ctx.shadowBlur = clip.shadowBlur ?? Math.max(2, clip.size * 0.1);
  }
  // Horizontal anchor follows alignment; 5% side padding for left/right.
  const pad = width * 0.05;
  const anchorX = align === "left" ? pad : align === "right" ? width - pad : width / 2;
  const lines = visibleText.split("\n");
  const lineHeight = clip.size * 1.2;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  const strokeW = clip.strokeWidth ?? 0;
  // Pass 1: outline (carries the shadow). Pass 2: fill on top with no shadow,
  // so the glyph interior stays crisp.
  if (strokeW > 0) {
    ctx.lineJoin = "round";
    ctx.strokeStyle = clip.strokeColor ?? "#000000";
    ctx.lineWidth = strokeW;
    lines.forEach((line, i) => ctx.strokeText(line, anchorX, startY + i * lineHeight));
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  }
  lines.forEach((line, i) => ctx.fillText(line, anchorX, startY + i * lineHeight));

  if (cache.size > 48) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, c);
  return c;
};
