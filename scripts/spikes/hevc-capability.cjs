// Capability spike (work order D3 / B11): can this runtime decode HEVC and
// QuickTime .mov, and does it honour rotation metadata? Run under Electron:
//   cd apps/desktop && pnpm exec electron ../../scripts/spikes/hevc-capability.cjs <fixtureDir>
// Loads hevc-probe.html from file:// (a secure context, like the app's app://
// origin) and prints one JSON report to stdout. No app code is involved.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const fixtureDir = path.resolve(process.argv[2] ?? ".");
const files = fs
  .readdirSync(fixtureDir)
  .filter((f) => /\.(mov|mp4|webm)$/i.test(f))
  .sort()
  .map((f) => path.join(fixtureDir, f));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadFile(path.join(__dirname, "hevc-probe.html"));
  try {
    const result = await win.webContents.executeJavaScript(
      `window.probe(${JSON.stringify(files)})`,
      true,
    );
    process.stdout.write(
      `${JSON.stringify({ runtime: "electron", electron: process.versions.electron, chrome: process.versions.chrome, ...result }, null, 2)}\n`,
    );
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ runtime: "electron", error: String(e) })}\n`);
  }
  app.exit(0);
});
