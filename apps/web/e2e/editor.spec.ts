import { expect, test, type Page } from "@playwright/test";

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
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();

  const projectName = page.locator('header input[type="text"]').first();
  await expect(projectName).toHaveValue("Untitled");
  await projectName.fill("E2E persistence project");
  await projectName.press("Enter");
  await expect(page).toHaveTitle("E2E persistence project — Movie Desk");

  await expect.poll(() => projectNamesInLibrary(page)).toContain("E2E persistence project");
  await page.reload();

  await expect(projectName).toHaveValue("E2E persistence project");
  await expect(page).toHaveTitle("E2E persistence project — Movie Desk");
});
