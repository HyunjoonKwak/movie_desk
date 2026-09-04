import { expect, test } from "@playwright/test";
import { PNG, configurePage, importMediaFiles, mediaCard, opfsKeys } from "./support";

// Release checklist (B24): running out of storage mid-import is explained per
// file, never takes the other files down, leaves no partial copy behind and
// can be retried once space is back.

test.beforeEach(async ({ page }) => {
  await configurePage(page);
  // Simulate a full disk for one file only: the OPFS write for any key that
  // ends in `__huge.png` fails with the browser's quota error until the test
  // "frees space" by flipping the flag.
  await page.addInitScript(() => {
    const flag = window as unknown as { __storageFull: boolean };
    flag.__storageFull = true;
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const writable = await original.apply(this, args);
      if (!this.name.endsWith("__huge.png")) return writable;
      const write = writable.write.bind(writable);
      writable.write = async (chunk) => {
        if (flag.__storageFull) throw new DOMException("Quota exceeded", "QuotaExceededError");
        return write(chunk);
      };
      return writable;
    };
  });
});

test("a full disk fails one file with a storage message, keeps the rest and retries", async ({
  page,
}) => {
  await page.goto("/editor");
  await importMediaFiles(page, [
    { name: "good.png", mimeType: "image/png", buffer: PNG },
    { name: "huge.png", mimeType: "image/png", buffer: PNG },
  ]);

  await expect(mediaCard(page, "good.png")).toBeVisible();
  await expect(page.getByText("Could not import 1 file(s)", { exact: true })).toBeVisible();
  await expect(page.getByText("huge.png", { exact: true })).toBeVisible();
  await expect(
    page.getByText("There is not enough storage space. Free some space and try again."),
  ).toBeVisible();
  await expect(mediaCard(page, "huge.png")).toHaveCount(0);

  // No partial copy is left behind in the media store.
  const keys = await opfsKeys(page);
  expect(keys.some((key) => key.endsWith("__huge.png"))).toBe(false);
  expect(keys.some((key) => key.endsWith("__good.png"))).toBe(true);

  // Space is back: the per-file retry imports it and clears the failure.
  await page.evaluate(() => {
    (window as unknown as { __storageFull: boolean }).__storageFull = false;
  });
  await page.getByTitle("Retry this file").click();
  await expect(mediaCard(page, "huge.png")).toBeVisible();
  await expect(page.getByText(/^Could not import/)).toHaveCount(0);
  expect((await opfsKeys(page)).some((key) => key.endsWith("__huge.png"))).toBe(true);
});
