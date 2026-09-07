import { rgbaToBt709I420 } from "./bt709-frame";

self.onmessage = (
  event: MessageEvent<{
    id: number;
    rgba: ArrayBuffer;
    yuv: ArrayBuffer;
    width: number;
    height: number;
  }>,
) => {
  const { id, rgba, yuv, width, height } = event.data;
  try {
    rgbaToBt709I420(new Uint8Array(rgba), width, height, new Uint8Array(yuv), true);
    self.postMessage({ id, rgba, yuv }, { transfer: [rgba, yuv] });
  } catch (error) {
    self.postMessage({ id, error: String(error), rgba, yuv }, { transfer: [rgba, yuv] });
  }
};
