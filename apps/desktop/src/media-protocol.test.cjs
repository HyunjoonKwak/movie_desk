const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  MediaLeaseRegistry,
  createMediaProtocolHandler,
  parseByteRange,
  parseMediaUrl,
} = require("./media-protocol.cjs");

const temporaryDirectories = new Set();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

const fixture = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-protocol-"));
  temporaryDirectories.add(root);
  const absolutePath = path.join(root, "clip.mov");
  fs.writeFileSync(absolutePath, "0123456789");
  const fileStat = await fs.promises.stat(absolutePath);
  const asset = {
    id: "asset-1",
    rootId: "root-1",
    relativePath: "clip.mov",
    sizeBytes: fileStat.size,
    modifiedAtMs: Math.trunc(fileStat.mtimeMs),
    mime: "video/quicktime",
    root: { lastKnownAbsolutePath: root },
  };
  const catalog = { getAsset: async (assetId) => (assetId === asset.id ? asset : null) };
  const leases = new MediaLeaseRegistry();
  const lease = leases.acquire(asset.id);
  const handler = createMediaProtocolHandler({ catalog, leases });
  return { absolutePath, asset, handler, lease, leases };
};

describe("parseByteRange", () => {
  it("accepts full, open-ended, bounded, and suffix ranges", () => {
    assert.deepEqual(parseByteRange(null, 10), {
      start: 0,
      end: 9,
      length: 10,
      partial: false,
    });
    assert.deepEqual(parseByteRange("bytes=4-", 10), {
      start: 4,
      end: 9,
      length: 6,
      partial: true,
    });
    assert.deepEqual(parseByteRange("bytes=2-5", 10), {
      start: 2,
      end: 5,
      length: 4,
      partial: true,
    });
    assert.deepEqual(parseByteRange("bytes=-3", 10), {
      start: 7,
      end: 9,
      length: 3,
      partial: true,
    });
  });

  it("rejects multiple and unsatisfiable ranges", () => {
    assert.equal(parseByteRange("bytes=0-1,3-4", 10), null);
    assert.equal(parseByteRange("bytes=10-", 10), null);
    assert.equal(parseByteRange("items=0-1", 10), null);
    assert.equal(parseByteRange("bytes=-0", 10), null);
  });
});

describe("media protocol", () => {
  it("streams GET ranges and exposes correct HTTP metadata", async () => {
    const media = await fixture();
    const response = await media.handler(
      new Request(media.lease.url, { headers: { Range: "bytes=2-5" } }),
    );

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("content-length"), "4");
    assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(response.headers.get("content-type"), "video/quicktime");
    assert.equal(await response.text(), "2345");
  });

  it("supports HEAD without opening a response body", async () => {
    const media = await fixture();
    const response = await media.handler(new Request(media.lease.url, { method: "HEAD" }));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), "10");
    assert.equal(response.body, null);
  });

  it("returns 416 for an invalid single range", async () => {
    const media = await fixture();
    const response = await media.handler(
      new Request(media.lease.url, { headers: { Range: "bytes=99-" } }),
    );

    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */10");
  });

  it("invalidates released leases and never accepts a path as an asset id", async () => {
    const media = await fixture();
    media.leases.release(media.lease.leaseId);
    assert.equal((await media.handler(new Request(media.lease.url))).status, 403);
    assert.equal(parseMediaUrl("media://asset/../../etc/passwd?lease=x"), null);
  });

  it("accepts every path-safe leading character used by core nanoid values", () => {
    const leases = new MediaLeaseRegistry();
    assert.match(leases.acquire("_asset").url, /_asset/);
    assert.match(leases.acquire("-asset").url, /-asset/);
  });

  it("refuses to stream a source that changed after cataloging", async () => {
    const media = await fixture();
    fs.appendFileSync(media.absolutePath, "changed");
    const response = await media.handler(new Request(media.lease.url));

    assert.equal(response.status, 409);
    assert.equal(response.headers.get("x-movie-desk-source-state"), "changed");
  });

  it("reuses the resolved source snapshot for every range in one lease", async () => {
    const media = await fixture();
    const resolved = {
      state: "online",
      absolutePath: await fs.promises.realpath(media.absolutePath),
    };
    const cachedLease = media.leases.acquire(media.asset.id, { asset: media.asset, resolved });
    const handler = createMediaProtocolHandler({
      catalog: { getAsset: async () => assert.fail("catalog should not be queried") },
      leases: media.leases,
      resolveSource: async () => assert.fail("source should not be resolved twice"),
    });

    const first = await handler(new Request(cachedLease.url, { headers: { Range: "bytes=0-1" } }));
    const second = await handler(new Request(cachedLease.url, { headers: { Range: "bytes=8-9" } }));
    assert.equal(await first.text(), "01");
    assert.equal(await second.text(), "89");
  });
});
