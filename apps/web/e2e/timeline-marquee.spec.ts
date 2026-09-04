import { expect, test, type Page } from "@playwright/test";
import { importMediaFiles } from "./support";

// Rubber-band selection is pointer-driven, so the unit suite (vitest, node
// environment) cannot reach it — the whole gesture shipped broken because the
// pointerup handler was never bound to anything. These run the real gesture.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// Cmd on macOS, Ctrl elsewhere — the panel accepts either.
const MARQUEE_KEY = process.platform === "darwin" ? "Meta" : "Control";
const RULER_Y = 14;

const configurePage = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
  });
};

// One text clip on the overlay track plus a run of image clips on the media
// track below it, so a band can be aimed at some clips and away from others.
const seedTimeline = async (page: Page): Promise<void> => {
  await page.goto("/editor");
  await importMediaFiles(page, { name: "pix.png", mimeType: "image/png", buffer: PNG });
  await page.getByText("pix.png", { exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("e"); // append to the timeline
  }
  await page.getByRole("button", { name: "T", exact: true }).click();
  // Selecting the asset appends one clip on its own, so the exact total is not
  // worth pinning; the tests locate clips by geometry.
  await expect.poll(() => page.locator("[data-clip]").count()).toBeGreaterThanOrEqual(4);
};

interface Box {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// Overlay rows are shorter than media rows, which is enough to tell the text
// clip apart from the image clips without reaching into the store.
const OVERLAY_MAX_H = 50;

const layout = async (page: Page) => {
  const { inner, clips } = await page.evaluate(() => {
    const el = document.querySelector("[data-tl-inner]") as HTMLElement;
    const ir = el.getBoundingClientRect();
    return {
      inner: { x: ir.left, y: ir.top },
      clips: [...el.querySelectorAll<HTMLElement>("[data-clip]")].map((c) => {
        const r = c.getBoundingClientRect();
        return {
          id: c.dataset.clip as string,
          x: r.left - ir.left,
          y: r.top - ir.top,
          w: r.width,
          h: r.height,
        };
      }),
    };
  });

  const overlay = clips.find((c: Box) => c.h < OVERLAY_MAX_H);
  const media = clips.filter((c: Box) => c.h >= OVERLAY_MAX_H).sort((a, b) => a.x - b.x);
  const first = media[0];
  const second = media[1];
  const last = media[media.length - 1];
  if (!overlay || !first || !second || !last) throw new Error("unexpected timeline layout");
  return { inner, overlay, first, second, last, belowY: first.y + first.h + 40 };
};

const selectedIds = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-clip]")]
      .filter((c) => c.className.includes("ring-accent"))
      .map((c) => c.dataset.clip as string),
  );

const playheadX = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="tl-playhead"]');
    return el ? Number.parseFloat(el.style.left) : Number.NaN;
  });

const scrubRuler = async (page: Page, from: number, to: number, innerX: number, innerY: number) => {
  await page.mouse.move(innerX + from, innerY + RULER_Y);
  await page.mouse.down();
  await page.mouse.move(innerX + to, innerY + RULER_Y, { steps: 8 });
  await page.mouse.up();
};

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("marquee selects clips across tracks and leaves the rest alone", async ({ page }) => {
  await seedTimeline(page);
  const { inner, overlay, first, second, last } = await layout(page);

  // Start in empty space below the media row, sweep up-left across the first
  // media clip and the text clip above it. The media clips further right sit
  // outside the band and must stay unselected.
  await page.mouse.move(inner.x + first.x + first.w - 20, inner.y + first.y + first.h + 40);
  await page.keyboard.down(MARQUEE_KEY);
  await page.mouse.down();
  await page.mouse.move(inner.x + overlay.x + 10, inner.y + overlay.y + 5, { steps: 12 });

  await expect(page.getByTestId("tl-marquee")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up(MARQUEE_KEY);

  await expect(page.getByTestId("tl-marquee")).toHaveCount(0);
  const selected = await selectedIds(page);
  expect(selected).toContain(overlay.id);
  expect(selected).toContain(first.id);
  expect(selected).not.toContain(second.id);
  expect(selected).not.toContain(last.id);
});

test("scrubbing still works after a marquee drag", async ({ page }) => {
  // The regression that made the broken marquee worse than useless: the stale
  // band state swallowed every later drag, so the playhead stopped moving.
  await seedTimeline(page);
  const { inner, belowY } = await layout(page);

  await page.mouse.move(inner.x + 700, inner.y + belowY);
  await page.keyboard.down(MARQUEE_KEY);
  await page.mouse.down();
  await page.mouse.move(inner.x + 400, inner.y + belowY - 20, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up(MARQUEE_KEY);

  const before = await playheadX(page);
  await scrubRuler(page, 300, 800, inner.x, inner.y);
  expect(await playheadX(page)).toBeGreaterThan(before);
});

test("a drag that starts on a clip never opens a marquee", async ({ page }) => {
  await seedTimeline(page);
  const { inner, first } = await layout(page);

  await page.mouse.move(inner.x + first.x + 30, inner.y + first.y + first.h / 2);
  await page.keyboard.down(MARQUEE_KEY);
  await page.mouse.down();
  await page.mouse.move(inner.x + first.x + 200, inner.y + first.y + 10, { steps: 8 });

  await expect(page.getByTestId("tl-marquee")).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up(MARQUEE_KEY);
});

test("Escape abandons the band and leaves no state behind", async ({ page }) => {
  await seedTimeline(page);
  const { inner, belowY } = await layout(page);

  await page.mouse.move(inner.x + 800, inner.y + belowY);
  await page.keyboard.down(MARQUEE_KEY);
  await page.mouse.down();
  await page.mouse.move(inner.x + 300, inner.y + belowY - 30, { steps: 8 });
  await expect(page.getByTestId("tl-marquee")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tl-marquee")).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up(MARQUEE_KEY);

  // Nothing selected, and the next ordinary drag scrubs as usual.
  expect(await selectedIds(page)).toEqual([]);
  const before = await playheadX(page);
  await scrubRuler(page, 200, 600, inner.x, inner.y);
  expect(await playheadX(page)).toBeGreaterThan(before);
});

test("clicking empty track space clears the selection but scrubbing does not", async ({ page }) => {
  await seedTimeline(page);
  const { inner, first, last } = await layout(page);

  await page.mouse.click(inner.x + first.x + 30, inner.y + first.y + first.h / 2);
  expect(await selectedIds(page)).toEqual([first.id]);

  // Dragging the ruler to seek must not throw the selection away.
  await scrubRuler(page, 300, 700, inner.x, inner.y);
  expect(await selectedIds(page)).toEqual([first.id]);

  // A click on empty space inside a track row does.
  await page.mouse.click(inner.x + last.x + last.w + 60, inner.y + last.y + last.h / 2);
  expect(await selectedIds(page)).toEqual([]);
});
