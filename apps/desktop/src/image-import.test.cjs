const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { MediaCatalog } = require("./catalog.cjs");
const { MediaHelperClient } = require("./helper-client.cjs");
const {
  EDIT_DIMENSION,
  THUMB_DIMENSION,
  createDesktopImageImporter,
  stableRootId,
  validateHeicPath,
} = require("./image-import.cjs");

const temporaryDirectories = new Set();
const catalogs = new Set();
const clients = new Set();

afterEach(async () => {
  await Promise.all([...catalogs].map((catalog) => catalog.close()));
  await Promise.all([...clients].map((client) => client.close()));
  catalogs.clear();
  clients.clear();
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

const fixture = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-heic-import-"));
  temporaryDirectories.add(directory);
  const sourcePath = path.join(directory, "Café.HEIC");
  fs.writeFileSync(sourcePath, "heic fixture bytes");
  return { directory, sourcePath };
};

const fakes = () => {
  const roots = new Map();
  const assets = new Map();
  const previewRequests = [];
  const helper = {
    request: async (command, input) => {
      if (command === "volume-resolve") {
        return {
          volumeUuid: "AAAA-BBBB-CCCC-DDDD",
          mountPoint: "/",
          volumeRelativePath: input.path.slice(1),
          fileSystem: "APFS",
        };
      }
      if (command === "inspect") {
        return {
          width: 4032,
          height: 3024,
          orientation: 6,
          capturedAtMs: 1_700_000_000_000,
          gpsLat: 37.5,
          gpsLon: 127.0,
          cameraMake: "Apple",
          cameraModel: "iPhone",
          lensModel: "Main Camera",
          colorSpace: "RGB",
          colorProfile: "Display P3",
        };
      }
      if (command === "fingerprint") {
        return { hash: `sha256:${"a".repeat(64)}` };
      }
      if (command === "preview") {
        previewRequests.push(input);
        await fs.promises.mkdir(path.dirname(input.outputPath), { recursive: true });
        await fs.promises.writeFile(input.outputPath, `jpeg-${input.maxDimension}`);
        return { outputPath: input.outputPath, pipelineVersion: "sips-preview-v1" };
      }
      throw new Error(`unexpected helper command: ${command}`);
    },
  };
  const catalog = {
    registerRoot: async (root) => {
      roots.set(root.id, root);
      return root;
    },
    upsertAsset: async (asset) => {
      const result = { ...asset, root: roots.get(asset.rootId) };
      assets.set(asset.id, result);
      return result;
    },
    getAssetByLocation: async (rootId, relativePath) =>
      [...assets.values()].find(
        (asset) => asset.rootId === rootId && asset.relativePath === relativePath,
      ) ?? null,
  };
  return { assets, catalog, helper, previewRequests, roots };
};

describe("desktop HEIC importer", () => {
  it("registers the untouched original and returns metadata plus a bounded thumbnail", async () => {
    const { directory, sourcePath } = fixture();
    const fake = fakes();
    const importer = createDesktopImageImporter({
      catalog: fake.catalog,
      helper: fake.helper,
      cacheDirectory: path.join(directory, "cache"),
    });

    const asset = await importer.importHeicFile(sourcePath);

    assert.match(asset.id, /^[a-f0-9-]{36}$/);
    assert.equal(asset.mime, "image/heic");
    assert.equal(asset.width, 4032);
    assert.equal(asset.height, 3024);
    assert.equal(asset.capturedAt, 1_700_000_000_000);
    assert.equal(asset.gpsLat, 37.5);
    assert.equal(asset.gpsLon, 127);
    assert.equal(asset.sourceImageMetadata.orientation, 6);
    assert.equal(asset.sourceImageMetadata.colorProfile, "Display P3");
    assert.match(asset.thumbDataUrl, /^data:image\/jpeg;base64,/);
    assert.equal(asset.sourceRef.rootSnapshot.lastKnownAbsolutePath, undefined);
    assert.equal(JSON.stringify(asset).includes('"lastKnownAbsolutePath"'), false);
    assert.equal(
      fake.roots.get(asset.sourceRef.rootId).lastKnownAbsolutePath,
      await fs.promises.realpath(directory),
    );
    assert.equal(fake.previewRequests[0].maxDimension, THUMB_DIMENSION);
    assert.equal(fs.readFileSync(sourcePath, "utf8"), "heic fixture bytes");
  });

  it("caches a 4096px editing source and keeps a stable root and asset identity", async () => {
    const { directory, sourcePath } = fixture();
    const fake = fakes();
    const importer = createDesktopImageImporter({
      catalog: fake.catalog,
      helper: fake.helper,
      cacheDirectory: path.join(directory, "cache"),
    });
    const asset = await importer.importHeicFile(sourcePath);
    const catalogAsset = fake.assets.get(asset.id);
    const resolved = { state: "online", absolutePath: sourcePath };

    const first = await importer.acquireEditingPreview(catalogAsset, resolved);
    const second = await importer.acquireEditingPreview(catalogAsset, resolved);
    const reimported = await importer.importHeicFile(sourcePath);

    assert.equal(first.absolutePath, second.absolutePath);
    assert.equal(reimported.id, asset.id);
    assert.equal(first.asset.mime, "image/jpeg");
    assert.equal(fake.previewRequests.length, 2);
    assert.equal(fake.previewRequests[1].maxDimension, EDIT_DIMENSION);
    assert.equal(
      asset.sourceRef.rootId,
      stableRootId(
        "AAAA-BBBB-CCCC-DDDD",
        await fs.promises.realpath(directory),
        (await fs.promises.realpath(directory)).slice(1),
      ),
    );
  });

  it("rejects paths that are not HEIC/HEIF before invoking native tools", async () => {
    const { directory } = fixture();
    const jpeg = path.join(directory, "photo.jpg");
    fs.writeFileSync(jpeg, "jpeg");
    await assert.rejects(validateHeicPath(jpeg), (error) => error.code === "UNSUPPORTED_FORMAT");
    await assert.rejects(
      validateHeicPath("relative.heic"),
      (error) => error.code === "INVALID_REQUEST",
    );
  });

  it(
    "imports a generated HEIC through the real helper and catalog on macOS",
    { skip: process.platform !== "darwin" },
    async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-heic-integration-"));
      temporaryDirectories.add(directory);
      const sourcePath = path.join(directory, "fixture.heic");
      execFileSync("/usr/bin/sips", [
        "-s",
        "format",
        "heic",
        path.join(__dirname, "..", "build", "icon.png"),
        "--out",
        sourcePath,
      ]);
      const catalog = new MediaCatalog(path.join(directory, "catalog.sqlite3"));
      catalogs.add(catalog);
      await catalog.ready();
      const helper = new MediaHelperClient();
      clients.add(helper);
      const importer = createDesktopImageImporter({
        catalog,
        helper,
        cacheDirectory: path.join(directory, "cache"),
      });

      const asset = await importer.importHeicFile(sourcePath);
      const catalogAsset = await catalog.getAsset(asset.id);
      const preview = await importer.acquireEditingPreview(catalogAsset, {
        state: "online",
        absolutePath: sourcePath,
      });

      assert.equal(asset.sourceRef.kind, "disk");
      assert.equal(asset.sourceRef.quickHash, catalogAsset.quickHash);
      assert.equal(asset.mime, "image/heic");
      assert.ok(asset.width > 0);
      assert.ok(asset.height > 0);
      assert.equal(preview.asset.mime, "image/jpeg");
      assert.ok(fs.statSync(preview.absolutePath).size > 0);
    },
  );
});
