import { renderClipAudio, type StretchRequest } from "@movie-desk/core";

self.onmessage = (event: MessageEvent<StretchRequest & { id: number }>) => {
  try {
    const started = performance.now();
    const channels = renderClipAudio(event.data);
    self.postMessage(
      { id: event.data.id, channels, dspMs: performance.now() - started },
      { transfer: channels.map((c) => c.buffer) },
    );
  } catch (error) {
    self.postMessage({ id: event.data.id, error: String(error) });
  }
};
