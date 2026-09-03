import type { Page } from "@playwright/test";

// Counts what the page's WebCodecs decoder and media elements actually do,
// so a spec can prove a clip went through VideoDecoder (configure + frames)
// rather than the <video> seek fallback. Installed before any page script.

export interface DecoderStats {
  readonly configures: readonly string[];
  readonly frames: number;
  readonly seeks: number;
}

declare global {
  interface Window {
    __decoderStats?: DecoderStats;
  }
}

export const installDecoderStats = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const stats = { configures: [] as string[], frames: 0, seeks: 0 };
    window.__decoderStats = stats;
    const Native = window.VideoDecoder;
    if (Native) {
      class CountingDecoder extends Native {
        constructor(init: VideoDecoderInit) {
          super({
            ...init,
            output: (frame) => {
              stats.frames += 1;
              init.output(frame);
            },
          });
        }
        override configure(config: VideoDecoderConfig): void {
          stats.configures.push(config.codec);
          super.configure(config);
        }
      }
      (window as unknown as { VideoDecoder: unknown }).VideoDecoder = CountingDecoder;
    }
    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    if (currentTime?.get && currentTime.set) {
      const setter = currentTime.set;
      Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
        get: currentTime.get,
        set(value: number) {
          stats.seeks += 1;
          setter.call(this, value);
        },
        configurable: true,
      });
    }
  });
};

export const readDecoderStats = (page: Page): Promise<DecoderStats | undefined> =>
  page.evaluate(() => window.__decoderStats);
