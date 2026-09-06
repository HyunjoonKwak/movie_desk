import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { configurePage, importMediaFiles, mediaCard } from "./support";

const run = <T>(page: Page, source: string): Promise<T> => page.evaluate<T>(`(${source})()`);
let bundle = "";
test.beforeAll(async () => {
  const require = createRequire(resolve("package.json"));
  const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))(
    "esbuild",
  );
  bundle = (
    await build({
      entryPoints: [resolve("src/export/audio-mixer.ts")],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "E2EMixer",
      logLevel: "silent",
      alias: {
        "@movie-desk/core": resolve("../../packages/core/src/index.ts"),
        "@": resolve("src"),
      },
    })
  ).outputFiles[0].text;
});

const tone = () => {
  const frames = 48000;
  const out = Buffer.alloc(44 + frames * 2);
  out.write("RIFF");
  out.writeUInt32LE(out.length - 8, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(48000, 24);
  out.writeUInt32LE(96000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    out.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 1000 * i) / 48000)), 44 + i * 2);
  return out;
};

const prepare = async (page: Page) => {
  await configurePage(page);
  await page.goto("/editor");
  await importMediaFiles(page, { name: "mixer-tone.wav", mimeType: "audio/wav", buffer: tone() });
  await expect(mediaCard(page, "mixer-tone.wav")).toBeVisible();
  if ((await page.locator("[data-clip]").count()) === 0) {
    await mediaCard(page, "mixer-tone.wav").click();
    await page.keyboard.press("e");
  }
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  await page.getByRole("button", { name: "Audio mixer", exact: true }).click();
  await page.addScriptTag({ content: bundle });
  // Read the app's persisted project, then use the actual export PCM mixer.
  // This assertion works on Chromium even when its AAC encoder is unavailable.
  await run(
    page,
    `() => {
    globalThis.readMixerProject = () => new Promise((resolve, reject) => {
      const open = indexedDB.open('cut_editor.library.v1');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => { const db = open.result; const req = db.transaction('projects').objectStore('projects').getAll(); req.onsuccess = () => { db.close(); resolve(req.result.map(row => JSON.parse(row.json)).sort((a,b) => b.updatedAt-a.updatedAt)[0]); }; };
    });
    globalThis.exportMixerRms = async () => {
      const p = await readMixerProject();
      const mixer = new E2EMixer.ProjectAudioMixer(p, id => p.mediaLibrary.find(asset => asset.id === id));
      let energy=0, count=0;
      try { for await (const chunk of mixer.chunks()) for (const channel of chunk.channels) for (const sample of channel) { energy += sample*sample; count++; } }
      finally { mixer.dispose(); }
      return count ? Math.sqrt(energy/count) : 0;
    };
  }`,
  );
  await expect
    .poll(() =>
      run<number>(
        page,
        "async () => (await readMixerProject())?.timeline.tracks.reduce((n,t)=>n+t.clips.length,0) ?? 0",
      ),
    )
    .toBeGreaterThan(0);
};

test("track -6 dB halves export PCM RMS and one undo restores gain", async ({ page }) => {
  await prepare(page);
  expect(
    await page.locator("[data-track] > div:first-child").evaluateAll((headers) =>
      headers.every((header) => {
        const bounds = header.getBoundingClientRect();
        return [...header.querySelectorAll("button")].every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.left >= bounds.left && rect.right <= bounds.right;
        });
      }),
    ),
  ).toBe(true);
  const before = await run<number>(page, "() => exportMixerRms()");
  expect(before).toBeGreaterThan(0.01);
  const gain = page.getByRole("spinbutton", { name: "A1 Gain", exact: true });
  await gain.fill("-6");
  await gain.press("Enter");
  await expect
    .poll(() =>
      run<number>(
        page,
        "async () => (await readMixerProject()).timeline.tracks.find(t=>t.name==='A1').audio?.gainDb ?? 0",
      ),
    )
    .toBe(-6);
  const after = await run<number>(page, "() => exportMixerRms()");
  expect(after / before).toBeCloseTo(10 ** (-6 / 20), 4);
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(gain).toHaveValue("0");
  // Insert/undo can leave the transport at the clip end; measure audible PCM from the start.
  await page.getByRole("button", { name: "Go to start", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole("meter", { name: "Measured master", exact: true })
          .first()
          .getAttribute("aria-valuenow"),
      ),
    )
    .toBeGreaterThan(-60);
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  if (await pause.isVisible()) await pause.click();
  await page.screenshot({ path: test.info().outputPath("audio-mixer-desktop.png") });
});

test("bus mute exports silence and mixer strips scroll at 390 pixels", async ({ page }) => {
  await prepare(page);
  await page.getByRole("button", { name: "Add bus", exact: true }).click();
  await page
    .getByRole("combobox", { name: "A1 Output", exact: true })
    .selectOption({ label: "Bus 1" });
  await page.getByRole("button", { name: "Bus 1 Mute", exact: true }).click();
  await expect
    .poll(() =>
      run<boolean>(page, "async () => (await readMixerProject()).audio?.buses[0]?.muted ?? false"),
    )
    .toBe(true);
  expect(await run<number>(page, "() => exportMixerRms()")).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Audio mixer", exact: true }).click();
  const strips = page.getByTestId("mixer-strips");
  const geometry = await strips.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(geometry.scroll).toBeGreaterThan(geometry.client);
  expect(geometry.page).toBeLessThanOrEqual(390);
  await strips.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect(page.getByRole("spinbutton", { name: "Master Gain", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("audio-mixer-mobile.png") });
});

test("opens a project with invalid mixer settings and explains the recovery once", async ({
  page,
}) => {
  await prepare(page);
  const clips = await page.locator("[data-clip]").count();
  const json = await run<string>(
    page,
    `async () => {
    const p = await readMixerProject();
    return JSON.stringify({ schema: "cut_editor-project", version: 1, exportedAt: Date.now(),
      project: { ...p, name: "Recovered mixer", audio: { buses: [], master: { gainDb: 100 } },
        timeline: { ...p.timeline, tracks: p.timeline.tracks.map(t => t.name === "A1" ? { ...t, audio: { pan: 2 } } : t) } } });
  }`,
  );
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator('input[type="file"][accept="application/json,.json"]')
    .setInputFiles({
      name: "recover-mixer.json",
      mimeType: "application/json",
      buffer: Buffer.from(json),
    });
  const notice = page.getByText(
    "The audio mixer settings could not be read; the project opened with defaults.",
    { exact: true },
  );
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Rename project" })).toHaveValue(
    "Recovered mixer",
  );
  await expect(page.locator("[data-clip]")).toHaveCount(clips);
  await expect
    .poll(() => run<boolean>(page, "async () => (await readMixerProject()).audio === undefined"))
    .toBe(true);
  expect(await run<number>(page, "() => exportMixerRms()")).toBeGreaterThan(0.01);
});
