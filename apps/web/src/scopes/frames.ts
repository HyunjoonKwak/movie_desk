import { type ScopePixels, ScopeReadback } from "./readback";

type Listener = (data: ScopePixels) => void;
let listener: Listener | null = null;
let reader: ScopeReadback | null = null;
let readerCanvas: HTMLCanvasElement | null = null;
let watchedCanvas: HTMLCanvasElement | null = null;
const resetReader = () => {
  generation++;
  reader?.dispose();
  reader = null;
  readerCanvas = null;
  busy = false;
};
const lost = (event: Event) => {
  event.preventDefault();
  resetReader();
  pending = true;
};
const restored = () => {
  resetReader();
  pending = true;
  redraw();
};
const watch = (canvas: HTMLCanvasElement | null) => {
  watchedCanvas?.removeEventListener("webglcontextlost", lost);
  watchedCanvas?.removeEventListener("webglcontextrestored", restored);
  watchedCanvas = canvas;
  canvas?.addEventListener("webglcontextlost", lost);
  canvas?.addEventListener("webglcontextrestored", restored);
};
let busy = false;
let rafBlocked = false;
let generation = 0;
let pending = false;
const redraw = () => {
  if (pending && !busy && !rafBlocked && listener) {
    pending = false;
    window.dispatchEvent(new Event("scopes-redraw"));
  }
};
export const subscribeFrames = (next: Listener) => {
  listener = next;
  pending = false;
  generation++;
  window.dispatchEvent(new Event("scopes-redraw"));
  return () => {
    if (listener === next) {
      listener = null;
      pending = false;
      busy = false;
      generation++;
      reader?.dispose();
      reader = null;
      readerCanvas = null;
      watch(null);
    }
  };
};
export const releaseFrame = (pixels?: Uint8ClampedArray, capturedGeneration?: number) => {
  if (capturedGeneration !== undefined && capturedGeneration !== generation) return false;
  if (pixels) reader?.recycle(pixels);
  busy = false;
  redraw();
  return true;
};
// Runs before the default drawing buffer is discarded. One snapshot per rAF,
// one GPU/worker job in flight, with a latest-frame redraw after backpressure.
export const captureScopes = (canvas: HTMLCanvasElement) => {
  if (!listener || !canvas.width || !canvas.height) return;
  if (busy || rafBlocked) {
    pending = true;
    return;
  }
  if (watchedCanvas !== canvas) watch(canvas);
  if (canvas.getContext("webgl2")?.isContextLost()) return;
  const current = generation;
  busy = true;
  rafBlocked = true;
  requestAnimationFrame(() => {
    rafBlocked = false;
    redraw();
  });
  const failed = () => {
    if (current !== generation) return;
    pending = false;
    releaseFrame();
    window.dispatchEvent(new Event("scopes-error"));
  };
  try {
    if (readerCanvas !== canvas) {
      reader?.dispose();
      reader = null;
      readerCanvas = canvas;
    }
    if (!reader) {
      const gl = canvas.getContext("webgl2");
      if (!gl) throw new Error("Scopes need WebGL2");
      reader = new ScopeReadback(gl);
    }
    reader.capture((data) => {
      if (current === generation && listener) listener({ ...data, generation: current });
    }, failed);
  } catch {
    failed();
  }
};
