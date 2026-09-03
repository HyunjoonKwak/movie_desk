const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { adoptLegacyUserData, chooseUserDataPath, hasUserData } = require("./user-data.cjs");

const current = "/Users/me/Library/Application Support/Movie Desk";
const legacy = "/Users/me/Library/Application Support/cut_editor";

describe("chooseUserDataPath", () => {
  it("keeps the new folder when there is no legacy folder", () => {
    const chosen = chooseUserDataPath({
      current,
      legacy,
      exists: (dir) => dir === current,
      hasData: () => false,
    });
    assert.equal(chosen, current);
  });

  it("adopts the legacy folder when the new one does not exist yet", () => {
    const chosen = chooseUserDataPath({
      current,
      legacy,
      exists: (dir) => dir === legacy,
      hasData: () => false,
    });
    assert.equal(chosen, legacy);
  });

  it("adopts the legacy folder when the new one exists but holds no data", () => {
    const chosen = chooseUserDataPath({
      current,
      legacy,
      exists: () => true,
      hasData: (dir) => dir === legacy,
    });
    assert.equal(chosen, legacy);
  });

  it("keeps the new folder once it holds data, even if the legacy one remains", () => {
    const chosen = chooseUserDataPath({
      current,
      legacy,
      exists: () => true,
      hasData: () => true,
    });
    assert.equal(chosen, current);
  });
});

describe("hasUserData", () => {
  it("recognises browser storage and app files, not an empty folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-userdata-"));
    assert.equal(hasUserData(root, fs, path), false);
    fs.mkdirSync(path.join(root, "IndexedDB"));
    assert.equal(hasUserData(root, fs, path), true);
  });
});

describe("adoptLegacyUserData", () => {
  it("moves userData and sessionData to the legacy folder together", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-appdata-"));
    fs.mkdirSync(path.join(appData, "cut_editor", "IndexedDB"), { recursive: true });
    const paths = { appData, userData: path.join(appData, "Movie Desk") };
    const app = {
      getPath: (name) => paths[name],
      setPath: (name, value) => {
        paths[name] = value;
      },
    };
    const chosen = adoptLegacyUserData(app, fs, path);
    assert.equal(chosen, path.join(appData, "cut_editor"));
    assert.equal(paths.userData, chosen);
    assert.equal(paths.sessionData, chosen);
  });
});
