import { expect, test } from "@playwright/test";
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
