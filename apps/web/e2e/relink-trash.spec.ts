import { type Page, expect, test } from "@playwright/test";
import {
  PNG,
  clipCount,
  configurePage,
  importMediaFiles,
  mediaCard,
  opfsKeys,
  revealMediaCard,
  seedTimeline,
} from "./support";

// Library safety (A4): a missing original can be relinked from a file, a
// look-alike is not swapped in silently, and removed media waits in the
// trash where it can be restored.

const removeOpfsKey = async (page: Page, suffix: string): Promise<void> => {
  const key = (await opfsKeys(page)).find((k) => k.endsWith(suffix));
  expect(key, `an OPFS key ending in ${suffix}`).toBeTruthy();
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(name);
  }, key as string);
};

const flagMissing = async (page: Page): Promise<void> => {
  await revealMediaCard(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(mediaCard(page).locator("[data-missing]")).toBeVisible({ timeout: 15_000 });
};

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("a missing original is relinked from a file of the same size", async ({ page }) => {
  await seedTimeline(page, 1);
  await removeOpfsKey(page, "__pix.png");
  await flagMissing(page);

  await mediaCard(page).hover();
  await page.locator("[data-relink]").click();
  await page
    .locator("[data-relink-input]")
    .setInputFiles({ name: "pix-copy.png", mimeType: "image/png", buffer: PNG });

  await expect(page.getByText('Relinked "pix.png"', { exact: true })).toBeVisible();
  await expect(mediaCard(page).locator("[data-missing]")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("[data-preview-missing]")).toHaveCount(0);
  expect((await opfsKeys(page)).some((key) => key.endsWith("__pix.png"))).toBe(true);
});

test("a file of a different size is only relinked after the user insists", async ({ page }) => {
  await seedTimeline(page, 1);
  await removeOpfsKey(page, "__pix.png");
  await flagMissing(page);

  await mediaCard(page).hover();
  await page.locator("[data-relink]").click();
  await page.locator("[data-relink-input]").setInputFiles({
    name: "bigger.png",
    mimeType: "image/png",
    buffer: Buffer.concat([PNG, Buffer.alloc(512)]),
  });

  await expect(page.getByText(/It may not be the same media/)).toBeVisible();
  await expect(mediaCard(page).locator("[data-missing]")).toBeVisible();
  await page.getByRole("button", { name: "Relink anyway" }).click();
  await expect(page.getByText('Relinked "pix.png"', { exact: true })).toBeVisible();
  await expect(mediaCard(page).locator("[data-missing]")).toHaveCount(0, { timeout: 15_000 });
});

test("removed media waits in the trash and can be restored", async ({ page }) => {
  const clips = await seedTimeline(page, 1);
  expect(clips).toBeGreaterThan(0);

  await mediaCard(page).hover();
  await page.getByTitle("Delete media").click();
  await expect(page.getByText('Moved "pix.png" to the trash', { exact: true })).toBeVisible();
  await expect(mediaCard(page)).toHaveCount(0);
  expect(await clipCount(page)).toBe(0);

  await page.getByRole("button", { name: /^Trash \(1\)$/ }).click();
  const dialog = page.locator("[data-trash-dialog]");
  await expect(dialog.getByText("pix.png", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText('Restored "pix.png"', { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(mediaCard(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Trash \(0\)$/ })).toBeVisible();
  // Restore brings the record back, not the clips: those are Undo's job.
  expect(await clipCount(page)).toBe(0);
});

test("a missing badge survives the preview checking only the clip under the playhead", async ({
  page,
}) => {
  await seedTimeline(page, 1);
  await importMediaFiles(page, { name: "other.png", mimeType: "image/png", buffer: PNG });
  await revealMediaCard(page, "other.png");
  await expect(mediaCard(page, "other.png")).toBeVisible();
  await removeOpfsKey(page, "__other.png");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(mediaCard(page, "other.png").locator("[data-missing]")).toBeVisible({
    timeout: 15_000,
  });
  // The playhead sits on pix.png, so the preview asks about that asset only.
  await page.keyboard.press("Home");
  await page.waitForTimeout(1_000);
  await expect(mediaCard(page, "other.png").locator("[data-missing]")).toBeVisible();
});

test("desktop same-size fingerprint mismatch waits for explicit relink confirmation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const sourceRef = {
      kind: "disk",
      version: 1,
      rootId: "r",
      rootSnapshot: {},
      relativePath: "photo.heic",
      sizeBytes: 8,
      modifiedAtMs: 1,
      quickHash: "sha256:old",
    };
    const host = window as unknown as { cutDesktop: unknown; relinkConfirmed?: boolean };
    host.cutDesktop = {
      isDesktop: true,
      media: {
        acquirePlaybackUrl: async () => ({ state: "offline" }),
        releasePlaybackUrl: async () => true,
        sourceState: async () => ({ state: "offline" }),
        importHeicFile: async () => ({
          ok: true,
          asset: {
            id: "disk-photo",
            name: "photo.heic",
            kind: "image",
            mime: "image/heic",
            durationMs: 5000,
            opfsPath: "disk-v1/disk-photo",
            sourceRef,
            sizeBytes: 8,
            sourceImageMetadata: {},
            thumbDataUrl: "data:image/jpeg;base64,/9j/2Q==",
            importedAt: 1,
          },
        }),
        chooseRelink: async () => [
          {
            assetId: "disk-photo",
            token: "selection",
            name: "copy.heic",
            relativePath: "photo.heic",
            verdict: "fingerprint",
            sizeBytes: 8,
            expectedSizeBytes: 8,
          },
        ],
        commitRelink: async (_token: string, confirmed: boolean) => {
          host.relinkConfirmed = confirmed;
          return {
            assetId: "disk-photo",
            identical: false,
            mime: "image/heic",
            sourceRef: { ...sourceRef, quickHash: "sha256:new" },
          };
        },
      },
    };
  });
  await page.goto("/editor");
  await importMediaFiles(page, { name: "photo.heic", mimeType: "image/heic", buffer: PNG });
  const card = await revealMediaCard(page, "photo.heic");
  await expect(card.locator("[data-missing]")).toBeVisible({ timeout: 15_000 });
  await card.hover();
  await page.locator("[data-relink]").click();
  await expect(
    page.getByText("Different or unknown fingerprint — confirmation required", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { relinkConfirmed?: boolean }).relinkConfirmed),
  ).toBeUndefined();
  await page.getByRole("button", { name: "Relink anyway" }).click();
  await expect(page.getByText('Relinked "copy.heic"', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { relinkConfirmed?: boolean }).relinkConfirmed),
  ).toBe(true);
});

test("desktop folder mismatch stays unchecked until the user selects that row", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const sourceRef = {
      kind: "disk",
      version: 1,
      rootId: "r",
      rootSnapshot: {},
      relativePath: "photo.heic",
      sizeBytes: 8,
      modifiedAtMs: 1,
      quickHash: "sha256:old",
    };
    const host = window as unknown as { cutDesktop: unknown; relinkConfirmed?: boolean };
    host.cutDesktop = {
      isDesktop: true,
      media: {
        acquirePlaybackUrl: async () => ({ state: "offline" }),
        releasePlaybackUrl: async () => true,
        sourceState: async () => ({ state: "offline" }),
        importHeicFile: async () => ({
          ok: true,
          asset: {
            id: "disk-photo",
            name: "photo.heic",
            kind: "image",
            mime: "image/heic",
            durationMs: 5000,
            opfsPath: "disk-v1/disk-photo",
            sourceRef,
            sizeBytes: 8,
            sourceImageMetadata: {},
            thumbDataUrl: "data:image/jpeg;base64,/9j/2Q==",
            importedAt: 1,
          },
        }),
        chooseRelink: async () => [
          {
            assetId: "disk-photo",
            token: "selection",
            name: "copy.heic",
            relativePath: "photo.heic",
            verdict: "fingerprint",
            sizeBytes: 8,
            expectedSizeBytes: 8,
          },
        ],
        commitRelink: async (_token: string, confirmed: boolean) => {
          host.relinkConfirmed = confirmed;
          return {
            assetId: "disk-photo",
            identical: false,
            mime: "image/heic",
            sourceRef: { ...sourceRef, quickHash: "sha256:new" },
          };
        },
      },
    };
  });
  await page.goto("/editor");
  await importMediaFiles(page, { name: "photo.heic", mimeType: "image/heic", buffer: PNG });
  const card = await revealMediaCard(page, "photo.heic");
  await expect(card.locator("[data-missing]")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Reconnect missing files from a folder…" }).click();
  const dialog = page.getByRole("dialog");
  const selection = dialog.getByRole("checkbox", { name: "photo.heic" });
  await expect(selection).not.toBeChecked();
  const connect = dialog.getByRole("button", { name: "Confirm and connect selected files" });
  await expect(connect).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { relinkConfirmed?: boolean }).relinkConfirmed)).toBeUndefined();
  await selection.check();
  await connect.click();
  await expect(dialog.getByText("Connected", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { relinkConfirmed?: boolean }).relinkConfirmed)).toBe(true);
});
