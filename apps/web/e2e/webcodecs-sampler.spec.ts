import path from "node:path";
import { type Page, expect, test } from "@playwright/test";

// Smoke for the shared analysis frame sampler (B15): importing an MP4 must
// analyse it through a real VideoDecoder — configure() accepted and frames
// delivered — rather than the media-element fallback. VP9-in-MP4 because
// Playwright's Chromium ships no H.264/HEVC decoder.

const FIXTURE = "vp9_clip.mp4";

interface DecoderStats {
  readonly configures: readonly string[];
  readonly frames: number;
  readonly seeks: number;
}

declare global {
  interface Window {
    __decoderStats?: DecoderStats;
  }
}

const configurePage = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");

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

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("analysis decodes an MP4 through a real VideoDecoder", async ({ page }) => {
  test.setTimeout(120_000);
  const fixtureDir = path.join(test.info().project.testDir, "fixtures");

  await page.goto("/editor");
  await page
    .locator('input[type="file"][accept="video/*,audio/*,image/*"]')
    .setInputFiles(path.join(fixtureDir, FIXTURE));
  await expect(page.getByText(FIXTURE, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Auto edit" }).click();
  await expect(page.getByText("1/1", { exact: true })).toBeVisible({ timeout: 90_000 });

  const stats = await page.evaluate(() => window.__decoderStats);
  test.info().annotations.push({ type: "decoder-stats", description: JSON.stringify(stats) });
  expect(stats?.configures.length ?? 0).toBeGreaterThan(0);
  expect(stats?.frames ?? 0).toBeGreaterThan(0);
});
