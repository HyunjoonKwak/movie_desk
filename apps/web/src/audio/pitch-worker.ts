import { type StretchRequest, renderClipAudio } from "@movie-desk/core";

self.onmessage = (event: MessageEvent<StretchRequest>) => {
  try {
    const started = process.env.NODE_ENV === "production" ? undefined : performance.now();
    const { channels, continuation } = renderClipAudio(event.data);
    self.postMessage(
      {
        channels,
        continuation,
        ...(started === undefined ? {} : { dspMs: performance.now() - started }),
      },
      { transfer: channels.map((c) => c.buffer) },
    );
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
