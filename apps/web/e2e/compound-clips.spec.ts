import { createEmptyProject, newId, type Project, type ShapeClip } from "@movie-desk/core";
import { expect, test, type Page } from "@playwright/test";

// The user journey that makes every earlier nested-sequence phase reachable:
// combine clips, open the compound, come back, and take it apart again.

const shape = (start: number, label: string): ShapeClip => ({
  id: newId(), kind: "shape", shape: "rect", fill: "#ff0000", stroke: "#000000", strokeWidth: 0,
  start, duration: 1000, speed: 1, effects: [], keyframes: [], label,
});

const fixture = (): Project => {
  const project = createEmptyProject({ name: "Compound journey", framerate: 25 });
  const clips = [shape(0, "First"), shape(2000, "Second")];
  const root = {
    ...project.timeline,
    duration: 3000,
    tracks: project.timeline.tracks.map((track, index) => ({
      ...track,
      clips: index === 0 ? clips : [],
    })),
  };
  return { ...project, timeline: root, timelines: [root] };
};

const load = async (page: Page, locale: string) => {
  await page.addInitScript((value) => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: value }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
  }, locale);
  await page.goto("/editor");
  await page.getByRole("button", { name: locale === "ko" ? "프로젝트" : "Projects", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator('input[type="file"][accept="application/json,.json"]')
    .setInputFiles({
      name: "compound.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          schema: "cut_editor-project",
          version: 2,
          exportedAt: Date.now(),
          project: fixture(),
        }),
      ),
    });
  await expect(page.locator("[data-clip]")).toHaveCount(2);
};

const words = {
  ko: { make: "컴파운드 만들기", unpack: "컴파운드 풀기", tabs: "타임라인", search: "명령 검색…" },
  en: { make: "Make compound", unpack: "Unpack compound", tabs: "Timelines", search: "Search commands…" },
} as const;

// Radix context menus do not activate under Playwright, so the journey drives
// the same store actions through the command palette, which is also how a
// keyboard-first editor would reach them.
const runCommand = async (page: Page, label: string) => {
  await page.keyboard.press("Meta+k");
  const search = page.getByRole("dialog").getByRole("textbox");
  await search.fill(label);
  await search.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
};

for (const locale of ["ko", "en"] as const) {
  const say = words[locale];

  test(`combines a selection, opens the child and takes it apart again (${locale})`, async ({ page }) => {
    await load(page, locale);
    // No compound yet, so the workspace must look exactly as it always did.
    await expect(page.getByRole("tablist", { name: say.tabs })).toHaveCount(0);

    const clips = page.locator("[data-clip]");
    await clips.first().click();
    await clips.nth(1).click({ modifiers: ["Shift"] });
    await runCommand(page, say.make);

    // One compound now stands where the two clips were.
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    const tabs = page.getByRole("tablist", { name: say.tabs });
    await expect(tabs).toBeVisible();

    // Open the child: its own clips are what the tab shows.
    await tabs.getByRole("tab").nth(1).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);

    // Back to the parent, then unpack and get the original two clips back.
    await tabs.getByRole("tab").first().click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await page.locator("[data-clip]").first().click();
    await runCommand(page, say.unpack);
    await expect(page.locator("[data-clip]")).toHaveCount(2);
  });

  test(`undo returns the two clips and takes the tab strip with it (${locale})`, async ({ page }) => {
    await load(page, locale);
    const clips = page.locator("[data-clip]");
    await clips.first().click();
    await clips.nth(1).click({ modifiers: ["Shift"] });
    await runCommand(page, say.make);
    await expect(page.locator("[data-clip]")).toHaveCount(1);

    await page.keyboard.press("Meta+z");
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await expect(page.getByRole("tablist", { name: say.tabs })).toHaveCount(0);
  });
}
