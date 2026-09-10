import { createEmptyProject, newId, type Project, type ShapeClip } from "@movie-desk/core";
import { expect, test } from "@playwright/test";

// Skimming must show the frame under the cursor in the viewer and must not
// move the playhead, enter history, or reach disk.

const fixture = (): Project => {
  const project = createEmptyProject({ name: "Skim", framerate: 25 });
  const clip: ShapeClip = {
    id: newId(), kind: "shape", shape: "rect", fill: "#ff0000", stroke: "#000000", strokeWidth: 0,
    start: 0, duration: 4000, speed: 1, effects: [], keyframes: [], label: "Red",
  };
  const root = {
    ...project.timeline,
    duration: 4000,
    tracks: project.timeline.tracks.map((track, index) => ({ ...track, clips: index === 0 ? [clip] : [] })),
  };
  return { ...project, timeline: root, timelines: [root] };
};

test("skimming renders the hovered time and leaves the playhead alone", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cut.locale.v1", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    localStorage.setItem("cut.persistence.welcomed", "1");
  });
  await page.goto("/editor");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("dialog").locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
    name: "skim.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schema: "cut_editor-project", version: 2, exportedAt: Date.now(), project: fixture() })),
  });
  const clip = page.locator("[data-clip]").first();
  await expect(clip).toBeVisible();
  const canvas = page.locator("[data-preview-canvas]");
  await expect(canvas).toHaveAttribute("data-render-playhead", "0");

  // Hover into the clip: the viewer follows the cursor, the playhead does not move.
  const box = (await clip.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(async () => Number(await canvas.getAttribute("data-render-playhead"))).toBeGreaterThan(500);
  await expect(page.getByTestId("skim-line")).toBeVisible();

  // Leaving the timeline restores the real playhead frame. Returning to 0
  // is also the proof that skimming never moved the playhead itself.
  await page.mouse.move(5, 5);
  await expect(canvas).toHaveAttribute("data-render-playhead", "0");
  await expect(page.getByTestId("skim-line")).toHaveCount(0);
});
