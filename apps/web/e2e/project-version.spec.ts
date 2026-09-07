import { createEmptyProject, PROJECT_VERSION } from "@movie-desk/core";
import { expect, test } from "@playwright/test";

const cases = [
  {
    locale: "en",
    menu: "Projects",
    older: "This project file uses an older format (v0) this app (v1) cannot open.",
    newer:
      "This project file needs a newer Movie Desk (file v2, this app v1). Update the app and try again.",
  },
  {
    locale: "ko",
    menu: "프로젝트",
    older: "이 프로젝트 파일은 오래된 형식(v0)이라 이 앱(v1)에서 열 수 없습니다.",
    newer:
      "이 프로젝트 파일은 더 새로운 Movie Desk가 필요합니다(파일 v2, 현재 앱 v1). 앱을 업데이트한 뒤 다시 시도하세요.",
  },
];

for (const entry of cases) {
  test(`version errors are translated in ${entry.locale} and preserve the open project`, async ({
    page,
  }) => {
    await page.addInitScript((locale) => {
      localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale }, version: 0 }));
      localStorage.setItem("cut.persistence.welcomed", "1");
    }, entry.locale);
    await page.goto("/editor");
    const name = page.locator('header input[type="text"]').first();
    await name.fill("Keep this project");
    await name.press("Enter");
    await page.getByRole("button", { name: entry.menu, exact: true }).click();
    const dialog = page.getByRole("dialog");
    for (const direction of ["older", "newer"] as const) {
      await dialog.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
        name: `${direction}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            schema: "cut_editor-project",
            version: PROJECT_VERSION + (direction === "older" ? -1 : 1),
            exportedAt: Date.now(),
            project: createEmptyProject({ name: "Do not load" }),
          }),
        ),
      });
      await expect(page.getByText(entry[direction], { exact: true })).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(name).toHaveValue("Keep this project");
    }
  });
}
