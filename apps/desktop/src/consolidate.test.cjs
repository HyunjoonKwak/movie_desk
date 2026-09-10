const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createConsolidator, uniqueDestination } = require("./consolidate.cjs");

const temporaryDirectories = new Set();

const temporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-consolidate-"));
  temporaryDirectories.add(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

const hashOf = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const build = (over = {}) => {
  const assets = new Map();
  const catalog = {
    async getAsset(id) {
      return assets.get(id);
    },
    async upsertAsset(asset) {
      assets.set(asset.id, { ...asset });
      return assets.get(asset.id);
    },
  };
  const helper = {
    async request(kind, payload) {
      if (kind === "fingerprint") {
        if (over.corruptCopy && payload.path.endsWith(".partial")) return { hash: "different" };
        return { hash: hashOf(payload.path) };
      }
      throw new Error(`unexpected ${kind}`);
    },
  };
  const consolidator = createConsolidator({
    catalog,
    helper,
    resolveSource: over.resolveSource ?? (async (asset) => ({
      state: "online",
      absolutePath: asset.absolutePath,
    })),
    registerRootFor: async () => "destination-root",
  });
  return { assets, catalog, consolidator };
};

describe("consolidate", () => {
  it("copies, verifies and re-points without touching the original", async () => {
    const source = temporaryDirectory();
    const destination = temporaryDirectory();
    const file = path.join(source, "clip.mp4");
    fs.writeFileSync(file, Buffer.alloc(4096, 3));
    const before = fs.statSync(file);

    const { assets, consolidator } = build();
    assets.set("a1", { id: "a1", rootId: "old", relativePath: "clip.mp4", absolutePath: file });

    const result = await consolidator.consolidate(["a1"], destination);

    assert.equal(result.failed.length, 0);
    assert.deepEqual(result.moved, [{ assetId: "a1", relativePath: "clip.mp4" }]);
    // The original is still there, unchanged.
    const after = fs.statSync(file);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    // The copy exists and matches.
    assert.equal(hashOf(path.join(destination, "clip.mp4")), hashOf(file));
    // The reference now points at the copy.
    assert.equal(assets.get("a1").rootId, "destination-root");
  });

  it("leaves the reference alone and cleans up when verification fails", async () => {
    const source = temporaryDirectory();
    const destination = temporaryDirectory();
    const file = path.join(source, "clip.mp4");
    fs.writeFileSync(file, Buffer.alloc(64, 5));

    const { assets, consolidator } = build({ corruptCopy: true });
    assets.set("a1", { id: "a1", rootId: "old", relativePath: "clip.mp4", absolutePath: file });

    const result = await consolidator.consolidate(["a1"], destination);

    assert.equal(result.moved.length, 0);
    assert.equal(result.failed[0].code, "VERIFY_FAILED");
    // The reference still points at the original, which is still readable.
    assert.equal(assets.get("a1").rootId, "old");
    assert.equal(fs.existsSync(file), true);
    // No half-written file was left behind under any name.
    assert.deepEqual(fs.readdirSync(destination), []);
  });

  it("never overwrites a file that is already in the destination", async () => {
    const source = temporaryDirectory();
    const destination = temporaryDirectory();
    const file = path.join(source, "clip.mp4");
    fs.writeFileSync(file, Buffer.alloc(64, 1));
    const existing = path.join(destination, "clip.mp4");
    fs.writeFileSync(existing, Buffer.alloc(8, 9));
    const existingHash = hashOf(existing);

    const { consolidator, assets } = build();
    assets.set("a1", { id: "a1", rootId: "old", relativePath: "clip.mp4", absolutePath: file });

    const result = await consolidator.consolidate(["a1"], destination);

    assert.equal(result.moved[0].relativePath, "clip 1.mp4");
    assert.equal(hashOf(existing), existingHash);
  });

  it("skips an asset whose original is offline rather than guessing", async () => {
    const destination = temporaryDirectory();
    const { consolidator, assets } = build({
      resolveSource: async () => ({ state: "offline" }),
    });
    assets.set("a1", { id: "a1", rootId: "old", relativePath: "clip.mp4" });

    const result = await consolidator.consolidate(["a1"], destination);
    assert.equal(result.failed[0].code, "SOURCE_OFFLINE");
    assert.equal(assets.get("a1").rootId, "old");
  });

  it("does not copy a file onto itself", async () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, "clip.mp4");
    fs.writeFileSync(file, Buffer.alloc(32, 2));
    const { consolidator, assets } = build();
    assets.set("a1", { id: "a1", rootId: "old", relativePath: "clip.mp4", absolutePath: file });

    const result = await consolidator.consolidate(["a1"], directory);
    assert.equal(result.moved[0].alreadyThere, true);
    assert.deepEqual(fs.readdirSync(directory), ["clip.mp4"]);
  });

  it("keeps going after one failure and reports both outcomes", async () => {
    const source = temporaryDirectory();
    const destination = temporaryDirectory();
    const good = path.join(source, "good.mp4");
    fs.writeFileSync(good, Buffer.alloc(32, 4));

    const { consolidator, assets } = build();
    assets.set("missing", undefined);
    assets.set("a2", { id: "a2", rootId: "old", relativePath: "good.mp4", absolutePath: good });

    const result = await consolidator.consolidate(["missing", "a2"], destination);
    assert.equal(result.failed[0].code, "ASSET_MISSING");
    assert.equal(result.moved[0].assetId, "a2");
  });

  it("stops when cancelled and reports it", async () => {
    const destination = temporaryDirectory();
    const { consolidator, assets } = build();
    assets.set("a1", { id: "a1", rootId: "old", relativePath: "clip.mp4" });
    const controller = new AbortController();
    controller.abort();

    const result = await consolidator.consolidate(["a1"], destination, { signal: controller.signal });
    assert.equal(result.cancelled, true);
    assert.equal(result.moved.length, 0);
  });

  it("refuses a relative destination and a destination that is not a folder", async () => {
    const { consolidator } = build();
    await assert.rejects(() => consolidator.consolidate([], "relative"), /absolute/);
    const directory = temporaryDirectory();
    const file = path.join(directory, "not-a-folder");
    fs.writeFileSync(file, "x");
    await assert.rejects(() => consolidator.consolidate([], file), /does not exist/);
  });

  it("finds an unused name without clobbering", async () => {
    const directory = temporaryDirectory();
    fs.writeFileSync(path.join(directory, "a.mp4"), "1");
    fs.writeFileSync(path.join(directory, "a 1.mp4"), "2");
    const { candidate } = await uniqueDestination(directory, "a.mp4");
    assert.equal(candidate, "a 2.mp4");
  });
});
