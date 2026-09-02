import fs from "node:fs";
import { createRequire } from "node:module";
// Same probe as hevc-capability.cjs, run in Playwright's Chromium (what CI
// uses) and in Google Chrome when installed, so the matrix shows where HEVC
// works and where it does not.
//   node scripts/spikes/hevc-capability-browser.mjs <fixtureDir>
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(path.resolve("apps/web/package.json"));
const { chromium } = require("@playwright/test");

const fixtureDir = path.resolve(process.argv[2] ?? ".");
const files = fs
  .readdirSync(fixtureDir)
  .filter((f) => /\.(mov|mp4|webm)$/i.test(f))
  .sort()
  .map((f) => path.join(fixtureDir, f));
const page_url = pathToFileURL(path.resolve("scripts/spikes/hevc-probe.html")).href;

const run = async (label, launchOpts) => {
  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (e) {
    return { runtime: label, error: `launch failed: ${e.message.split("\n")[0]}` };
  }
  const page = await browser.newPage();
  await page.goto(page_url);
  const result = await page.evaluate((paths) => window.probe(paths), files);
  await browser.close();
  return { runtime: label, ...result };
};

const out = [
  await run("playwright-chromium", {}),
  await run("google-chrome", { channel: "chrome" }),
];
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
