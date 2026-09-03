// Rendering and decoding outrun a software encoder many times over; without
// a cap every pending frame sits in memory and progress bars lie. Callers
// wait here after each encode() so the queue never grows past `limit`.

const MAX_ENCODE_QUEUE = 8;

export const waitForEncoderQueue = async (
  encoder: VideoEncoder,
  limit = MAX_ENCODE_QUEUE,
): Promise<void> => {
  while (encoder.encodeQueueSize > limit && encoder.state === "configured") {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, 50);
      function done() {
        clearTimeout(timer);
        encoder.removeEventListener("dequeue", done);
        resolve();
      }
      encoder.addEventListener("dequeue", done, { once: true });
    });
  }
};
