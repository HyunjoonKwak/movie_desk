import { clipping } from "./compute";
import { type ScopeKind, paintScope } from "./paint";
import type { ScopePixels } from "./readback";
const out = new OffscreenCanvas(256, 200);
self.onmessage = (event: MessageEvent<ScopePixels & { kind: ScopeKind }>) => {
  const { pixels, width, height, kind, captureMs, readMs, generation } = event.data;
  try {
    const start = performance.now();
    paintScope(out.getContext("2d")!, 256, 200, kind, pixels, width, height);
    const stats = clipping(pixels);
    const result = out.transferToImageBitmap();
    self.postMessage(
      {
        bitmap: result,
        pixels,
        generation,
        stats,
        captureMs: captureMs + readMs,
        workerMs: performance.now() - start,
      },
      { transfer: [result, pixels.buffer] },
    );
  } catch {
    self.postMessage({ error: true, pixels, generation }, { transfer: [pixels.buffer] });
  }
};
