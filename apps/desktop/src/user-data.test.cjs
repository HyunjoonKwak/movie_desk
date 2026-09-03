const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DECISION_FILE,
  OUR_STORAGE_MARKER,
  adoptLegacyUserData,
  chooseUserData,
  hasOurStorage,
} = require("./user-data.cjs");

describe("chooseUserData", () => {
  it("adopts the legacy folder only when it is a directory holding Movie Desk storage", () => {
    assert.equal(
      chooseUserData({ decision: null, legacyIsDirectory: true, legacyHasOurStorage: true }),
      "legacy",
    );
    assert.equal(
      chooseUserData({ decision: null, legacyIsDirectory: true, legacyHasOurStorage: false }),
      "current",
    );
    assert.equal(
      chooseUserData({ decision: null, legacyIsDirectory: false, legacyHasOurStorage: false }),
      "current",
    );
  });

  it("keeps a recorded decision regardless of what the folders hold now", () => {
    assert.equal(
      chooseUserData({ decision: "current", legacyIsDirectory: true, legacyHasOurStorage: true }),
      "current",
    );
    assert.equal(
      chooseUserData({ decision: "legacy", legacyIsDirectory: false, legacyHasOurStorage: false }),
      "legacy",
    );
  });
});

const fakeApp = (appData) => {
  const paths = { appData, userData: path.join(appData, "Movie Desk") };
  return {
    paths,
    app: {
      getPath: (name) => paths[name],
      setPath: (name, value) => {
        paths[name] = value;
      },
    },
  };
};

const legacyWithStorage = (appData) => {
  const legacy = path.join(appData, "cut_editor");
  fs.mkdirSync(path.join(legacy, ...OUR_STORAGE_MARKER), { recursive: true });
  return legacy;
};

describe("adoptLegacyUserData", () => {
  it("moves userData and sessionData to the legacy folder and records the decision", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-appdata-"));
    const legacy = legacyWithStorage(appData);
    const { app, paths } = fakeApp(appData);
    assert.equal(adoptLegacyUserData(app, fs, path), legacy);
    assert.equal(paths.userData, legacy);
    assert.equal(paths.sessionData, legacy);
    const decision = JSON.parse(
      fs.readFileSync(path.join(appData, "Movie Desk", DECISION_FILE), "utf8"),
    );
    assert.equal(decision.userData, "legacy");
  });

  it("still adopts when a previous launch already created the new folder with window state", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-appdata-"));
    const legacy = legacyWithStorage(appData);
    fs.mkdirSync(path.join(appData, "Movie Desk", "Local Storage"), { recursive: true });
    fs.writeFileSync(path.join(appData, "Movie Desk", "window-state.json"), "{}");
    const { app } = fakeApp(appData);
    assert.equal(adoptLegacyUserData(app, fs, path), legacy);
  });

  it("ignores a cut_editor folder that is not Movie Desk's, or is a file", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-appdata-"));
    fs.mkdirSync(path.join(appData, "cut_editor", "Local Storage"), { recursive: true });
    const first = fakeApp(appData);
    assert.equal(adoptLegacyUserData(first.app, fs, path), first.paths.userData);

    const appData2 = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-appdata-"));
    fs.writeFileSync(path.join(appData2, "cut_editor"), "not a folder");
    const second = fakeApp(appData2);
    assert.equal(adoptLegacyUserData(second.app, fs, path), second.paths.userData);
  });

  it("honours a recorded decision on later launches", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-appdata-"));
    legacyWithStorage(appData);
    const { app, paths } = fakeApp(appData);
    fs.mkdirSync(paths.userData, { recursive: true });
    fs.writeFileSync(
      path.join(paths.userData, DECISION_FILE),
      JSON.stringify({ userData: "current" }),
    );
    assert.equal(adoptLegacyUserData(app, fs, path), paths.userData);
    assert.equal(paths.sessionData, undefined);
  });

  it("never throws: a setPath failure keeps the default folder", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-appdata-"));
    legacyWithStorage(appData);
    const { app, paths } = fakeApp(appData);
    app.setPath = () => {
      throw new Error("override failed");
    };
    const messages = [];
    assert.equal(
      adoptLegacyUserData(app, fs, path, (m) => messages.push(m)),
      paths.userData,
    );
    assert.match(messages[0], /keeping default/);
  });
});

describe("hasOurStorage", () => {
  it("looks for the app://cut-editor IndexedDB directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "movie-desk-storage-"));
    assert.equal(hasOurStorage(root, fs, path), false);
    fs.mkdirSync(path.join(root, ...OUR_STORAGE_MARKER), { recursive: true });
    assert.equal(hasOurStorage(root, fs, path), true);
  });
});
