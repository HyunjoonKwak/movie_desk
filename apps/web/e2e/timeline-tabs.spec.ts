import { createEmptyProject, newId, type Project, type SequenceClip, type ShapeClip } from "@movie-desk/core";
import { expect, test, type Page } from "@playwright/test";

const fixture = (nested: boolean): Project => {
  const project = createEmptyProject({ name: "Timeline editing", framerate: 25 });
  const shape: ShapeClip = {
    id: newId(), kind: "shape", shape: "rect", fill: "#ff0000", stroke: "#000000", strokeWidth: 0,
    start: 0, duration: 2000, speed: 1, effects: [], keyframes: [], label: "Child picture",
  };
  const childBase = createEmptyProject().timeline;
  const child = { ...childBase, duration: 2000, tracks: childBase.tracks.map((track, index) => ({ ...track, clips: index === 0 ? [shape] : [] })) };
  const sequence: SequenceClip = {
    id: newId(), kind: "sequence", timelineId: child.id, start: 0, duration: 2000,
    trimIn: 0, trimOut: 2000, speed: 1, effects: [], keyframes: [], label: "Parent sequence",
  };
  const root = { ...project.timeline, duration: 2000, tracks: project.timeline.tracks.map((track, index) => ({ ...track, clips: index === 0 ? [nested ? sequence : shape] : [] })) };
  return { ...project, timeline: root, timelines: nested ? [root, child] : [root] };
};

const load = async (page: Page, project: Project, locale: string) => {
  await page.addInitScript((locale) => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
  }, locale);
  await page.goto("/editor");
  await page.getByRole("button", { name: locale === "ko" ? "프로젝트" : "Projects", exact: true }).click();
  await page.getByRole("dialog").locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
    name: "timelines.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schema: "cut_editor-project", version: 2, exportedAt: Date.now(), project })),
  });
  await expect(page.locator("[data-clip]")).toHaveCount(1);
};

for (const locale of ["ko", "en"]) {
  test(`existing nested project: child edit, parent result and undo retain the selected tab (${locale})`, async ({ page }) => {
    const project = fixture(true);
    await load(page, project, locale);
    const tabs = page.getByRole("tablist", { name: locale === "ko" ? "타임라인" : "Timelines" });
    const root = tabs.getByRole("tab", { name: locale === "ko" ? "메인 타임라인" : "Main timeline" });
    const child = tabs.getByRole("tab", { name: locale === "ko" ? "이름 없는 타임라인 1" : "Unnamed timeline 1" });
    await expect(root).toHaveAttribute("aria-selected", "true");
    const canvas = page.locator("[data-preview-canvas]");
    await expect(canvas).toBeVisible();
    const before = await canvas.screenshot();
    await child.click();
    await expect(child).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-clip]")).toContainText("Child picture");
    await page.locator("[data-clip]").click();
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-clip]")).toHaveCount(0);
    await root.click();
    await expect(page.locator("[data-clip]")).toContainText("Parent sequence");
    await expect.poll(async () => Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
    await child.click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(child).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await root.click();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(root).toHaveAttribute("aria-selected", "true");
    await child.click();
    await expect(page.locator("[data-clip]")).toHaveCount(0);
    await child.press("Home");
    await expect(root).toBeFocused();
    await root.press("End");
    await expect(child).toBeFocused();
  });

  test(`single timeline keeps the existing layout and editing without a tab bar (${locale})`, async ({ page }) => {
    await load(page, fixture(false), locale);
    await expect(page.getByRole("tablist", { name: locale === "ko" ? "타임라인" : "Timelines" })).toHaveCount(0);
    const inner = page.locator("[data-tl-inner]");
    const bounds = await inner.boundingBox();
    await page.locator("[data-clip]").click();
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-clip]")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    expect(await inner.boundingBox()).toEqual(bounds);
    await expect(page.getByRole("tabpanel")).toHaveCount(0);
  });
}

test("Korean tabs remain keyboard-accessible at the minimum editor width", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  const project = fixture(true);
  await load(page, project, "ko");
  const tabs = page.getByRole("tablist", { name: "타임라인" });
  const first = tabs.getByRole("tab").first();
  await first.focus();
  await first.press("ArrowRight");
  await expect(tabs.getByRole("tab").last()).toBeFocused();
  await expect(tabs.getByRole("tab").last()).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
