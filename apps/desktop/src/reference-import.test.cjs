const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createReferenceImporter,
  mediaKindFor,
  mimeFor,
  validateSourcePath,
} = require("./reference-import.cjs");

const temporaryDirectories = new Set();

const temporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-ref-"));
  temporaryDirectories.add(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

const fakeCatalog = () => {
  const roots = [];
  const assets = new Map();
  return {
    roots,
    assets,
    async registerRoot(root) {
      roots.push(root);
    },
    async getAssetByLocation(rootId, relativePath) {
      return assets.get(`${rootId} ${relativePath}`);
    },
    async upsertAsset(asset) {
      const stored = { ...asset };
      assets.set(`${asset.rootId} ${asset.relativePath}`, stored);
      return stored;
    },
  };
};

const fakeHelper = (overrides = {}) => ({
  async request(kind) {
    if (kind === "volume-resolve")
      return { volumeUuid: "VOL-1", volumeRelativePath: "Movies/clip.mp4", fileSystem: "apfs" };
    if (kind === "fingerprint") return { hash: "quick-hash" };
    if (kind === "inspect") {
      if (overrides.inspectThrows) throw new Error("probe failed");
      return { width: 1920, height: 1080, durationMs: 4200 };
    }
    throw new Error(`unexpected helper request: ${kind}`);
  },
});

const importerFor = (catalog, helper) =>
  createReferenceImporter({
    catalog,
    helper,
    toDiskSourceRef: (asset) => ({
      kind: "disk",
      version: 1,
      rootId: asset.rootId,
      rootSnapshot: { volumeUuid: "VOL-1", lastKnownAbsolutePath: "/private/hint" },
      relativePath: asset.relativePath,
      sizeBytes: asset.sizeBytes,
      modifiedAtMs: asset.modifiedAtMs,
    }),
  });

describe("reference import", () => {
  it("registers a file where it lives and never writes to it", async () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, "clip.mp4");
    fs.writeFileSync(file, Buffer.alloc(2048, 7));
    const before = fs.statSync(file);

    const catalog = fakeCatalog();
    const asset = await importerFor(catalog, fakeHelper()).importFile(file);

    assert.equal(asset.kind, "video");
    assert.equal(asset.mime, "video/mp4");
    assert.equal(asset.sizeBytes, 2048);
    assert.equal(asset.durationMs, 4200);
    assert.equal(catalog.roots.length, 1);

    const after = fs.statSync(file);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.deepEqual(fs.readdirSync(directory), ["clip.mp4"]);
  });

  it("never hands the absolute path back to the caller", async () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, "clip.mp4");
    fs.writeFileSync(file, Buffer.alloc(16));
    const asset = await importerFor(fakeCatalog(), fakeHelper()).importFile(file);
    assert.equal("lastKnownAbsolutePath" in asset.sourceRef.rootSnapshot, false);
    assert.equal(JSON.stringify(asset).includes(directory), false);
  });

  it("keeps the same id when the same file is imported again", async () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, "clip.mp4");
    fs.writeFileSync(file, Buffer.alloc(16));
    const catalog = fakeCatalog();
    const importer = importerFor(catalog, fakeHelper());
    const first = await importer.importFile(file);
    const second = await importer.importFile(file);
    assert.equal(second.id, first.id);
  });

  it("still imports when the probe fails, so one odd file cannot stop a batch", async () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, "clip.mov");
    fs.writeFileSync(file, Buffer.alloc(16));
    const asset = await importerFor(
      fakeCatalog(),
      fakeHelper({ inspectThrows: true }),
    ).importFile(file);
    assert.equal(asset.mime, "video/quicktime");
    assert.equal(asset.width, undefined);
  });

  it("gives a still image a usable default duration", async () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, "shot.png");
    fs.writeFileSync(file, Buffer.alloc(16));
    const helper = {
      async request(kind) {
        if (kind === "volume-resolve") return { volumeUuid: "VOL-1", volumeRelativePath: "a/b.png" };
        if (kind === "fingerprint") return { hash: "h" };
        return { width: 800, height: 600 };
      },
    };
    const asset = await importerFor(fakeCatalog(), helper).importFile(file);
    assert.equal(asset.kind, "image");
    assert.equal(asset.durationMs, 5000);
  });

  it("refuses a relative path, a missing file, a document and a directory", async () => {
    const directory = temporaryDirectory();
    await assert.rejects(() => validateSourcePath("relative.mp4"), /absolute/);
    await assert.rejects(() => validateSourcePath(path.join(directory, "nope.mp4")), /not found/);
    const document = path.join(directory, "notes.txt");
    fs.writeFileSync(document, "x");
    await assert.rejects(() => validateSourcePath(document), /not referenced in place/);
    fs.mkdirSync(path.join(directory, "folder.mp4"));
    await assert.rejects(() => validateSourcePath(path.join(directory, "folder.mp4")), /not a file/);
  });

  it("maps the formats it claims to support", () => {
    assert.equal(mediaKindFor(".mp4"), "video");
    assert.equal(mediaKindFor(".png"), "image");
    assert.equal(mediaKindFor(".wav"), "audio");
    assert.equal(mediaKindFor(".txt"), undefined);
    assert.equal(mimeFor(".m4a"), "audio/mp4");
  });
});
