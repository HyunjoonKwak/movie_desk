import { expect, test, type Page } from "@playwright/test";
import { importMediaFiles } from "./support";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const configurePage = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
  });
};

const projectNamesInLibrary = async (page: Page): Promise<string[]> =>
  page.evaluate(
    async () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("cut_editor.library.v1");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction("projects", "readonly").objectStore("projects").getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(
              request.result.map((row: { name?: unknown }) =>
                typeof row.name === "string" ? row.name : "",
              ),
            );
          };
        };
      }),
  );

test.beforeEach(async ({ page }) => {
  await configurePage(page);
});

test("opens the editor from the landing page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "편집 시작" }).click();

  await expect(page).toHaveURL(/\/editor$/);
  await expect(page.getByRole("button", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
});

test("persists a newly named project across a reload", async ({ page }) => {
  await page.goto("/editor");
  const projectsButton = page.getByRole("button", { name: "Projects" });
  await projectsButton.click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  // Project creation persists the new record before closing the async dialog.
  // Wait for Radix to finish closing and restoring focus before editing the
  // input behind it; actionability alone can catch the teardown mid-frame.
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(projectsButton).toBeFocused();

  const projectName = page.locator('header input[type="text"]').first();
  await expect(projectName).toHaveValue("Untitled");
  await projectName.fill("E2E persistence project");
  await expect(projectName).toHaveValue("E2E persistence project");
  await projectName.press("Enter");
  await expect(page).toHaveTitle("E2E persistence project — Movie Desk");

  await expect.poll(() => projectNamesInLibrary(page)).toContain("E2E persistence project");
  await page.reload();

  await expect(projectName).toHaveValue("E2E persistence project");
  await expect(page).toHaveTitle("E2E persistence project — Movie Desk");
});

test("keeps populated panels contained at compact desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/editor");

  const filename = "a-very-long-family-trip-video-filename-for-layout-check.png";
  await importMediaFiles(page, { name: filename, mimeType: "image/png", buffer: PNG });
  await expect(page.getByText(filename, { exact: true })).toBeVisible();

  const overflows = await page
    .getByTestId("media-controls")
    .locator("*")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const el = node as HTMLElement;
          return (
            getComputedStyle(el).overflowX === "visible" && el.scrollWidth > el.clientWidth + 2
          );
        })
        .map((node) => (node.textContent ?? "").trim()),
    );
  expect(overflows).toEqual([]);

  await page.getByTitle("Click to add to timeline").click();
  const clip = page.locator("[data-clip]").first();
  await expect(clip).toBeVisible();
  await clip.click();

  const assetValue = page.locator(`dd[title="${filename}"]`);
  await expect(assetValue).toBeVisible();
  await expect(assetValue).toHaveCSS("text-overflow", "ellipsis");
  await expect(assetValue).toHaveCSS("white-space", "nowrap");
});
