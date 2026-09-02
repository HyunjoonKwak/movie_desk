// Capability spike (work order D3 / B10): can Electron decode HEIC stills?
// Run under Electron with a HEIC fixture and an optional JPEG control:
//   cd apps/desktop
//   pnpm exec electron ../../scripts/spikes/heic-capability.cjs sample.heic sample.jpg
//
// The files are passed to the renderer as typed Blobs. This isolates codec
// support from file:// permissions and from Movie Desk's app:// MIME mapping.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const mimeFromPath = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".heic" || ext === ".heif") return "image/heic";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
};

const fixtures = process.argv.slice(2).map((input) => {
  const filePath = path.resolve(input);
  return {
    name: path.basename(filePath),
    mime: mimeFromPath(filePath),
    base64: fs.readFileSync(filePath).toString("base64"),
  };
});

if (fixtures.length === 0) {
  process.stderr.write("Pass at least one HEIC fixture path.\n");
  process.exit(2);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadFile(path.join(__dirname, "heic-probe.html"));
  try {
    const result = await win.webContents.executeJavaScript(
      `window.probe(${JSON.stringify(fixtures)})`,
      true,
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          runtime: "electron",
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          ...result,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ runtime: "electron", error: String(error) })}\n`);
  }
  app.exit(0);
});
