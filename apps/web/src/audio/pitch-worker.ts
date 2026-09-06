import { type StretchRequest, renderClipAudio } from "@movie-desk/core";

self.onmessage = (event: MessageEvent<StretchRequest & { id: number }>) => {
  try {
    const started = process.env.NODE_ENV === "production" ? undefined : performance.now();
    const channels = renderClipAudio(event.data);
    self.postMessage(
      {
        id: event.data.id,
        channels,
        continuation: event.data.continuation,
        ...(started === undefined ? {} : { dspMs: performance.now() - started }),
      },
      { transfer: channels.map((c) => c.buffer) },
    );
  } catch (error) {
    self.postMessage({ id: event.data.id, error: String(error) });
  }
};
