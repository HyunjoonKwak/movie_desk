const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MediaHelperClient } = require("./helper-client.cjs");
const { HELPER_PROTOCOL_VERSION, validateHelperRequest } = require("./helper-protocol.cjs");

const clients = new Set();
const temporaryDirectories = new Set();

afterEach(async () => {
  await Promise.all([...clients].map((client) => client.close()));
  clients.clear();
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

const client = () => {
  const value = new MediaHelperClient();
  clients.add(value);
  return value;
};

const temporaryFile = (contents) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-helper-"));
  temporaryDirectories.add(directory);
  const file = path.join(directory, "fixture.bin");
  fs.writeFileSync(file, contents);
  return { directory, file };
};

describe("helper protocol", () => {
  it("requires an exact protocol version and known command", () => {
    const request = {
      version: HELPER_PROTOCOL_VERSION,
      id: "request-1",
      command: "fingerprint",
      input: { path: "/tmp/file", mode: "quick" },
    };
    assert.equal(validateHelperRequest(request), request);
    assert.throws(() => validateHelperRequest({ ...request, version: 2 }), /unsupported/);
    assert.throws(() => validateHelperRequest({ ...request, command: "delete" }), /unsupported/);
  });

  it("round-trips quick and full fingerprints through the JSON-lines sidecar", async () => {
    const source = temporaryFile("Movie Desk media helper fixture");
    const helper = client();
    const quick = await helper.request("fingerprint", { path: source.file, mode: "quick" });
    const full = await helper.request("fingerprint", { path: source.file, mode: "full" });

    assert.equal(quick.algorithm, "sha256-size-head-tail-v1");
    assert.equal(quick.sizeBytes, 31);
    assert.match(quick.hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      full.hash,
      `sha256:${crypto.createHash("sha256").update("Movie Desk media helper fixture").digest("hex")}`,
    );
  });

  it("returns structured errors without terminating the sidecar", async () => {
    const helper = client();
    await assert.rejects(
      helper.request("fingerprint", { path: "relative.mov", mode: "quick" }),
      (error) => error.code === "INVALID_REQUEST",
    );
    const source = temporaryFile("still alive");
    assert.equal(
      (await helper.request("fingerprint", { path: source.file, mode: "full" })).sizeBytes,
      11,
    );
  });

  it(
    "creates and inspects a bounded sips preview on macOS",
    { skip: process.platform !== "darwin" },
    async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-preview-"));
      temporaryDirectories.add(directory);
      const outputPath = path.join(directory, "preview.jpg");
      const sourcePath = path.join(__dirname, "..", "build", "icon.png");
      const helper = client();
      const preview = await helper.request("preview", {
        sourcePath,
        outputPath,
        maxDimension: 240,
        format: "jpeg",
      });
      const inspected = await helper.request("inspect", { path: outputPath });

      assert.equal(preview.pipelineVersion, "sips-preview-v1");
      assert.equal(fs.existsSync(outputPath), true);
      assert.ok(inspected.width <= 240);
      assert.ok(inspected.height <= 240);
    },
  );

  it(
    "resolves a nested macOS path to a stable volume UUID and relative path",
    { skip: process.platform !== "darwin" },
    async () => {
      const helper = client();
      const resolved = await helper.request("volume-resolve", { path: process.cwd() });
      const mounted = await helper.request("volume-mount", { volumeUuid: resolved.volumeUuid });

      assert.match(resolved.volumeUuid, /^[A-F0-9-]{36}$/);
      assert.equal(mounted.volumeUuid, resolved.volumeUuid);
      assert.equal(mounted.mountPoint, resolved.mountPoint);
      assert.equal(path.isAbsolute(resolved.mountPoint), true);
      assert.equal(path.isAbsolute(resolved.volumeRelativePath), false);
      const reconstructed = path.join(resolved.mountPoint, resolved.volumeRelativePath);
      assert.equal(
        (await fs.promises.stat(reconstructed)).ino,
        (await fs.promises.stat(process.cwd())).ino,
      );
    },
  );
});
