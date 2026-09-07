import { clipping } from "./compute";
import { paintScope, type ScopeKind } from "./paint";
import type { ScopePixels } from "./readback";
const out = new OffscreenCanvas(256, 200);
self.onmessage = (event: MessageEvent<ScopePixels & { kind: ScopeKind }>) => {
  const { pixels, width, height, kind, captureMs, readMs } = event.data;
  try {
    const start = performance.now();
    paintScope(out.getContext("2d")!, 256, 200, kind, pixels, width, height);
    const stats = clipping(pixels);
    const result = out.transferToImageBitmap();
    self.postMessage(
      { bitmap: result, stats, captureMs: captureMs + readMs, workerMs: performance.now() - start },
      { transfer: [result] },
    );
  } catch {
    self.postMessage({ error: true });
  }
};
