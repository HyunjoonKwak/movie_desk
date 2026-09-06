import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { PNG, configurePage, importMediaFiles, mediaCard } from "./support";

const libraryJson = async (page: import("@playwright/test").Page): Promise<string> =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open("cut_editor.library.v1");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          try {
            if (!db.objectStoreNames.contains("projects")) {
              db.close();
              resolve("");
              return;
            }
            const request = db.transaction("projects", "readonly").objectStore("projects").getAll();
            request.onerror = () => {
              db.close();
              reject(request.error);
            };
            request.onsuccess = () => {
              try {
                resolve(request.result.map((row: { json?: string }) => row.json ?? "").join("\n"));
              } catch (error) {
                reject(error);
              } finally {
                db.close();
              }
            };
          } catch (error) {
            db.close();
            if (error instanceof DOMException && error.name === "NotFoundError") resolve("");
            else reject(error);
          }
        };
      }),
  );

test("keeps thumbnails outside project persistence and restores them after reload", async ({
  page,
}) => {
  await configurePage(page);
  await page.goto("/editor");
  await importMediaFiles(page, { name: "preview.png", mimeType: "image/png", buffer: PNG });

  const card = mediaCard(page, "preview.png");
  const image = card.locator("img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", /^data:image/);
  await expect.poll(() => libraryJson(page)).toContain("preview.png");
  await expect.poll(() => libraryJson(page)).not.toContain("data:image");

  await page.reload();
  await expect(mediaCard(page, "preview.png").locator("img")).toHaveAttribute("src", /^data:image/);

  await page.getByRole("button", { name: "Projects" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const json = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of json) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString("utf8")).toContain("data:image");
});

test("keeps waveforms outside project persistence and restores them on the timeline", async ({
  page,
}) => {
  await configurePage(page);
  await page.goto("/editor");
  await importMediaFiles(
    page,
    fileURLToPath(new URL("../src/media/__tests__/fixtures/aac-video.mp4", import.meta.url)),
  );

  const card = mediaCard(page, "aac-video.mp4");
  await expect(card).toBeVisible();
  await expect.poll(() => libraryJson(page)).toContain("aac-video.mp4");
  await expect.poll(() => libraryJson(page)).toContain('"hasAudio":true');
  await expect.poll(() => libraryJson(page)).not.toContain("waveformPeaks");
  await card.click();
  await page.keyboard.press("e");
  await expect(page.getByTestId("clip-waveform").first()).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("clip-waveform").first()).toBeVisible();
  await expect.poll(() => libraryJson(page)).not.toContain("waveformPeaks");
});

test("regenerates a deleted thumbnail from the original", async ({ page }) => {
  await configurePage(page);
  await page.goto("/editor");
  await importMediaFiles(page, { name: "rebuild.png", mimeType: "image/png", buffer: PNG });
  await expect(mediaCard(page, "rebuild.png").locator("img")).toBeVisible();
  await expect.poll(() => libraryJson(page)).toContain("rebuild.png");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("movie-desk.previews.v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("previews", "readwrite");
          tx.objectStore("previews").clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  const card = page.locator("[data-asset-card]").filter({ hasText: "rebuild.png" });
  await expect(card).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
  await card.hover();
  await card.getByRole("button", { name: "Regenerate previews" }).click();
  await expect(card.locator("img")).toHaveAttribute("src", /^data:image/);
  await page.reload();
  await expect(mediaCard(page, "rebuild.png").locator("img")).toHaveAttribute("src", /^data:image/);
});

test("snapshot cleanup requires confirmation and keeps the latest twenty", async ({ page }) => {
  await configurePage(page);
  await page.goto("/editor");
  await importMediaFiles(page, { name: "snap.png", mimeType: "image/png", buffer: PNG });
  await expect.poll(() => libraryJson(page)).toContain("snap.png");
  const project = (await libraryJson(page))
    .split("\n")
    .map((row) => JSON.parse(row) as { id: string; mediaLibrary?: { name: string }[] })
    .find((row) => row.mediaLibrary?.some((asset) => asset.name === "snap.png"));
  if (!project) throw new Error("Imported project was not persisted");
  // Open the menu once to initialize the snapshot database.
  await page.getByRole("button", { name: "Snapshots", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(
    (project) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("cut_editor.snapshots.v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("snapshots", "readwrite");
          for (let i = 0; i < 22; i++)
            tx.objectStore("snapshots").put({
              id: `snapshot-${i}`,
              projectId: project.id,
              label: `save ${i}`,
              createdAt: i,
              json: JSON.stringify(project),
            });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    project,
  );
  await page.getByRole("button", { name: "Snapshots", exact: true }).click();
  await expect(page.getByText("2 snapshots available to clean up (keep latest 20)")).toBeVisible();
  await page.getByRole("button", { name: "Review snapshots to delete" }).click();
  await page.getByRole("button", { name: "Cancel cleanup" }).click();
  await expect(page.getByRole("dialog").locator("li")).toHaveCount(22);
  await page.getByRole("button", { name: "Review snapshots to delete" }).click();
  await page.getByRole("button", { name: "Delete listed snapshots" }).click();
  await expect(page.getByRole("dialog").locator("li")).toHaveCount(20);
  await expect(page.getByText("save 0", { exact: true })).toHaveCount(0);
  await expect(page.getByText("save 21", { exact: true })).toBeVisible();
});
