const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, pickDmgAsset, evaluateRelease } = require("./update-check.cjs");

describe("compareVersions", () => {
  it("orders plain semver", () => {
    assert.ok(compareVersions("0.2.3", "0.2.2") > 0);
    assert.ok(compareVersions("0.2.2", "0.2.3") < 0);
    assert.equal(compareVersions("0.2.2", "0.2.2"), 0);
    assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  });
  it("tolerates v prefix and prerelease suffixes", () => {
    assert.equal(compareVersions("v0.2.2", "0.2.2"), 0);
    assert.ok(compareVersions("0.3.0-beta", "0.2.9") > 0);
  });
});

describe("pickDmgAsset", () => {
  const assets = [
    { name: "latest-mac.yml", browser_download_url: "u0" },
    { name: "Movie Desk-0.2.2-arm64.dmg", browser_download_url: "u1" },
    { name: "Movie Desk-0.2.2-arm64.dmg.blockmap", browser_download_url: "u2" },
    { name: "Movie Desk-0.2.2.dmg", browser_download_url: "u3" },
    { name: "Movie Desk-0.2.2.dmg.blockmap", browser_download_url: "u4" },
  ];
  it("picks the arm64 dmg on arm64", () => {
    assert.equal(pickDmgAsset(assets, "arm64").browser_download_url, "u1");
  });
  it("picks the plain dmg on x64, never a blockmap", () => {
    assert.equal(pickDmgAsset(assets, "x64").browser_download_url, "u3");
  });
  it("returns null when no dmg exists", () => {
    assert.equal(pickDmgAsset([{ name: "latest-mac.yml" }], "arm64"), null);
  });
});

describe("evaluateRelease", () => {
  const release = {
    tag_name: "v0.2.3",
    html_url: "https://github.com/HyunjoonKwak/movie_desk/releases/tag/v0.2.3",
    body: "notes",
    assets: [
      { name: "Movie Desk-0.2.3-arm64.dmg", browser_download_url: "dl-arm" },
      { name: "Movie Desk-0.2.3.dmg", browser_download_url: "dl-x64" },
    ],
  };
  it("reports an update with the arch-matching download", () => {
    const r = evaluateRelease({ currentVersion: "0.2.2", release, arch: "arm64" });
    assert.equal(r.status, "update");
    assert.equal(r.latestVersion, "0.2.3");
    assert.equal(r.downloadUrl, "dl-arm");
    assert.equal(r.notes, "notes");
  });
  it("reports current when already on the latest (or newer)", () => {
    assert.equal(evaluateRelease({ currentVersion: "0.2.3", release, arch: "arm64" }).status, "current");
    assert.equal(evaluateRelease({ currentVersion: "0.3.0", release, arch: "arm64" }).status, "current");
  });
  it("falls back to the release page when assets are missing", () => {
    const bare = { tag_name: "v9.9.9", html_url: "page" };
    const r = evaluateRelease({ currentVersion: "0.2.2", release: bare, arch: "arm64" });
    assert.equal(r.status, "update");
    assert.equal(r.downloadUrl, "page");
  });
  it("errors on a malformed payload", () => {
    assert.equal(evaluateRelease({ currentVersion: "0.2.2", release: {}, arch: "arm64" }).status, "error");
  });
});
