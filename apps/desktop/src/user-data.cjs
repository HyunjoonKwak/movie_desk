// Where the app keeps its local data. Renaming the product moved Electron's
// userData from Application Support/cut_editor to Application Support/Movie
// Desk, which hides every project, OPFS copy and catalog an existing user
// already has. The first launch of a build that knows about this decides
// once — keep using the old folder in place when it holds Movie Desk data —
// and pins the decision in a marker file, so a later launch that has since
// written its own window state or storage does not flip it back. No copy,
// so nothing can be left half-migrated.
//
// Pure helpers (no Electron import) so the decision is unit-testable; the
// glue at the bottom is what main.cjs calls before anything touches userData.

const LEGACY_DIR_NAME = "cut_editor";
const DECISION_FILE = "user-data-location.json";
// Chromium's on-disk name for the app://cut-editor origin's IndexedDB: only
// Movie Desk (or its cut_editor-era build) creates it, so an unrelated app
// that happens to use the same folder name is never adopted.
const OUR_STORAGE_MARKER = ["IndexedDB", "app_cut-editor_0.indexeddb.leveldb"];

const readDecision = (current, fs, path) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(current, DECISION_FILE), "utf8"));
    return parsed?.userData === "legacy" || parsed?.userData === "current" ? parsed.userData : null;
  } catch {
    return null;
  }
};

const writeDecision = (current, decision, fs, path) => {
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(
    path.join(current, DECISION_FILE),
    `${JSON.stringify({ userData: decision, decidedAt: new Date().toISOString() }, null, 2)}\n`,
  );
};

const isDirectory = (dir, fs) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

const hasOurStorage = (dir, fs, path) => isDirectory(path.join(dir, ...OUR_STORAGE_MARKER), fs);

// Returns "legacy" or "current". A recorded decision wins; otherwise the
// legacy folder is adopted when it is a directory holding Movie Desk storage.
const chooseUserData = ({ decision, legacyIsDirectory, legacyHasOurStorage }) => {
  if (decision) return decision;
  return legacyIsDirectory && legacyHasOurStorage ? "legacy" : "current";
};

// Returns the directory the app will use. Call after app.setName() and
// before app.whenReady(): both userData and sessionData move together so
// the storage partition follows. Never throws: a failure keeps the default.
const adoptLegacyUserData = (app, fs, path, log = () => {}) => {
  const current = app.getPath("userData");
  try {
    const legacy = path.join(app.getPath("appData"), LEGACY_DIR_NAME);
    const recorded = readDecision(current, fs, path);
    const decision = chooseUserData({
      decision: recorded,
      legacyIsDirectory: isDirectory(legacy, fs),
      legacyHasOurStorage: hasOurStorage(legacy, fs, path),
    });
    if (!recorded) writeDecision(current, decision, fs, path);
    if (decision === "legacy") {
      app.setPath("userData", legacy);
      app.setPath("sessionData", legacy);
      log(`using legacy user data at ${legacy}`);
      return legacy;
    }
    return current;
  } catch (error) {
    log(
      `keeping default user data (${current}): ${error instanceof Error ? error.message : error}`,
    );
    return current;
  }
};

module.exports = {
  LEGACY_DIR_NAME,
  DECISION_FILE,
  OUR_STORAGE_MARKER,
  chooseUserData,
  hasOurStorage,
  adoptLegacyUserData,
};
