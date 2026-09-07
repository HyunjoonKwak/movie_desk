import { expect, test } from "@playwright/test";

test("new project reports a library quota failure without claiming creation succeeded", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
  });
  await page.goto("/editor");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "projects") throw new DOMException("disk full", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await dialog.getByRole("button", { name: "New", exact: true }).click();
  await expect(
    page
      .getByText(
        "Could not save to the project library. Edit again to retry, or export a project copy before closing.",
      )
      .first(),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Created new project", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
