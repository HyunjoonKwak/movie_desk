const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { MediaCatalog } = require("./catalog.cjs");
const { DesktopRelinker, compareFingerprint, matchFolderPaths } = require("./desktop-relink.cjs");

const setup = async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-relink-"));
  const catalog = new MediaCatalog(path.join(dir, "catalog.sqlite3"));
  await catalog.ready();
  t.after(async () => {
    await catalog.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const original = path.join(dir, "original.png");
  await fs.writeFile(original, "original");
  const hash = async (file) =>
    createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex");
  const stat = await fs.stat(original);
  await catalog.registerRoot({ id: "root", kind: "local", lastKnownAbsolutePath: dir });
  await catalog.upsertAsset({
    id: "asset",
    rootId: "root",
    relativePath: "original.png",
    sizeBytes: stat.size,
    modifiedAtMs: Math.trunc(stat.mtimeMs),
    quickHash: await hash(original),
    mime: "image/png",
    mediaKind: "image",
  });
  await catalog.setUserMetadata({ assetId: "asset", note: "keep my note", tags: ["favorite"] });
  const helper = {
    request: async (command, input) => {
      if (command === "inspect") return { kind: "image", width: 20, height: 10 };
      if (command === "fingerprint") return { hash: await hash(input.path) };
      if (command === "volume-resolve")
        return { mountPoint: "/", volumeUuid: "volume", volumeRelativePath: input.path.slice(1) };
      throw new Error(command);
    },
  };
  return { dir, catalog, original, service: new DesktopRelinker({ catalog, helper }) };
};

test("same-size different bytes require confirmation, and original bytes and metadata survive", async (t) => {
  const { dir, catalog, original, service } = await setup(t);
  const candidate = path.join(dir, "candidate.png");
  await fs.writeFile(candidate, "changed!");
  const row = await service.prepare("asset", candidate, 1);
  assert.equal(row.verdict, "fingerprint");
  assert.ok(!JSON.stringify(row).includes(dir));
  await assert.rejects(service.commit(row.token, false, 1), /Confirm/);
  assert.equal((await catalog.getAsset("asset")).relativePath, "original.png");
  const result = await service.commit(row.token, true, 1);
  assert.equal(result.identical, false);
  assert.equal(result.sourceRef.relativePath, "candidate.png");
  assert.equal(result.sourceRef.rootSnapshot.lastKnownAbsolutePath, undefined);
  assert.equal(await fs.readFile(original, "utf8"), "original");
  assert.equal(await fs.readFile(candidate, "utf8"), "changed!");
  assert.equal((await catalog.getUserMetadata("asset")).note, "keep my note");
});

test("identical renamed file connects without mismatch confirmation and token is single-use", async (t) => {
  const { dir, original, service } = await setup(t);
  const candidate = path.join(dir, "renamed.png");
  await fs.copyFile(original, candidate);
  const row = await service.prepare("asset", candidate, 1);
  assert.equal(row.verdict, "identical");
  await assert.rejects(service.commit(row.token, false, 2), /expired/);
  assert.equal((await service.commit(row.token, false, 1)).identical, true);
  await assert.rejects(service.commit(row.token, true, 1), /expired/);
});

test("candidate changed after preview is refused even after confirmation", async (t) => {
  const { dir, original, service } = await setup(t);
  const candidate = path.join(dir, "renamed.png");
  await fs.copyFile(original, candidate);
  const row = await service.prepare("asset", candidate, 1);
  await fs.writeFile(candidate, "changed!");
  await assert.rejects(service.commit(row.token, true, 1), /changed/);
});

test("folder matches exact relative paths, skips unavailable and rejects symlink escape", async (t) => {
  const { dir, original, service } = await setup(t);
  const folder = path.join(dir, "folder");
  await fs.mkdir(folder);
  assert.equal((await service.prepareFolder(["asset"], folder, 1))[0].verdict, "unavailable");
  await fs.symlink(original, path.join(folder, "original.png"));
  assert.equal((await service.prepareFolder(["asset"], folder, 1))[0].verdict, "unavailable");
  await fs.unlink(path.join(folder, "original.png"));
  await fs.copyFile(original, path.join(folder, "original.png"));
  assert.equal((await service.prepareFolder(["asset"], folder, 1))[0].verdict, "identical");
  assert.throws(() => matchFolderPaths([{ relativePath: "../escape" }], folder));
});

test("fingerprint comparison does not infer identity from size or inode", () => {
  assert.equal(compareFingerprint({ sizeBytes: 1 }, { sizeBytes: 1 }), "fingerprint");
  assert.equal(
    compareFingerprint(
      { sizeBytes: 1, fullHash: "full", quickHash: "q" },
      { sizeBytes: 1, fullHash: "different", quickHash: "q" },
    ),
    "fingerprint",
  );
});

test("folder relink preserves nested relative structure for the next reconnection", async (t) => {
  const { dir, catalog, original, service } = await setup(t);
  const old = await catalog.getAsset("asset");
  await catalog.upsertAsset({ ...old, relativePath: "day1/original.png" });
  const folder = path.join(dir, "new-root");
  await fs.mkdir(path.join(folder, "day1"), { recursive: true });
  await fs.copyFile(original, path.join(folder, "day1", "original.png"));
  const [row] = await service.prepareFolder(["asset"], folder, 1);
  const result = await service.commit(row.token, true, 1);
  assert.equal(result.sourceRef.relativePath, "day1/original.png");
  assert.equal((await catalog.getAsset("asset")).root.lastKnownAbsolutePath, await fs.realpath(folder));
});
