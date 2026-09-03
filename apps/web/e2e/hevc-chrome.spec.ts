import path from "node:path";
import { type Page, expect, test } from "@playwright/test";

// Local Chrome-channel journey for HEVC .mov (B11 gate that CI cannot run:
// Playwright's Chromium ships no HEVC decoder). An iPhone-style rotated
// HEVC .mov must import with its display size, and analysis must decode it
// through a real VideoDecoder configured for HEVC — not the element fallback.
// Runs only under `pnpm test:e2e:chrome` (project "chrome-hevc").

const FIXTURE = "hevc-rotated90.mov";

interface DecoderStats {
  readonly configures: readonly string[];
  readonly frames: number;
}

declare global {
  interface Window {
    __hevcStats?: DecoderStats;
  }
}

const configurePage = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
    const stats = { configures: [] as string[], frames: 0 };
    window.__hevcStats = stats;
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
  });
};

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("imports a rotated HEVC .mov and analyses it through an HEVC VideoDecoder", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = path.join(
    test.info().project.testDir,
    "..",
    "src",
    "media",
    "__tests__",
    "fixtures",
    FIXTURE,
  );

  // WebCodecs only exists in a secure context, so ask after the page loads.
  await page.goto("/editor");
  const supported = await page.evaluate(async () => {
    if (typeof VideoDecoder === "undefined") return false;
    const result = await VideoDecoder.isConfigSupported({ codec: "hvc1.1.6.L93.B0" });
    return result.supported === true;
  });
  test.skip(!supported, "this Chrome build has no HEVC decoder");

  await page.locator('input[type="file"][accept="video/*,audio/*,image/*"]').setInputFiles(fixture);
  await expect(page.getByText(FIXTURE, { exact: true })).toBeVisible();
  // 160×90 source with a 90° display matrix: the library shows the display size.
  await expect(page.getByText("90×160", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Auto edit" }).click();
  await expect(page.getByText("1/1", { exact: true })).toBeVisible({ timeout: 90_000 });

  const stats = await page.evaluate(() => window.__hevcStats);
  test.info().annotations.push({ type: "decoder-stats", description: JSON.stringify(stats) });
  expect(stats?.configures.some((codec) => /^(hvc1|hev1)/.test(codec))).toBe(true);
  expect(stats?.frames ?? 0).toBeGreaterThan(0);
});
