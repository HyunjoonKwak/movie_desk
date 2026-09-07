import { ScopeReadback, type ScopePixels } from "./readback";

type Listener = (data: ScopePixels) => void;
let listener: Listener | null = null;
let reader: ScopeReadback | null = null;
let readerCanvas: HTMLCanvasElement | null = null;
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
    }
  };
};
export const releaseFrame = () => {
  busy = false;
  redraw();
};
// Runs before the default drawing buffer is discarded. One snapshot per rAF,
// one GPU/worker job in flight, with a latest-frame redraw after backpressure.
export const captureScopes = (canvas: HTMLCanvasElement) => {
  if (!listener || !canvas.width || !canvas.height) return;
  if (busy || rafBlocked) {
    pending = true;
    return;
  }
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
      if (current === generation && listener) listener(data);
    }, failed);
  } catch {
    failed();
  }
};
