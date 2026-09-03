// Where the app keeps its local data. Renaming the product moved Electron's
// userData from Application Support/cut_editor to Application Support/Movie
// Desk, which hides every project, OPFS copy and catalog an existing user
// already has. Until the new folder holds data of its own, keep using the
// old one in place: no copy, so nothing can be left half-migrated, and the
// app:// origin's storage stays exactly where the browser engine wrote it.
//
// Pure helpers (no Electron import) so the decision is unit-testable; the
// glue at the bottom is what main.cjs calls before anything touches userData.

const LEGACY_DIR_NAME = "cut_editor";

// Anything the browser engine or the app writes on first use. An empty or
// freshly created folder has none of these.
const DATA_MARKERS = [
  "IndexedDB",
  "Local Storage",
  "File System",
  "Partitions",
  "catalog",
  "window-state.json",
  "update-state.json",
];

const chooseUserDataPath = ({ current, legacy, exists, hasData }) => {
  if (current === legacy || !exists(legacy)) return current;
  if (exists(current) && hasData(current)) return current;
  return legacy;
};

const hasUserData = (dir, fs, path) =>
  DATA_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)));

// Returns the directory the app will use. Call after app.setName() and
// before app.whenReady(): both userData and sessionData move together so
// the storage partition follows.
const adoptLegacyUserData = (app, fs, path) => {
  const current = app.getPath("userData");
  const legacy = path.join(app.getPath("appData"), LEGACY_DIR_NAME);
  const chosen = chooseUserDataPath({
    current,
    legacy,
    exists: (dir) => fs.existsSync(dir),
    hasData: (dir) => hasUserData(dir, fs, path),
  });
  if (chosen !== current) {
    app.setPath("userData", chosen);
    app.setPath("sessionData", chosen);
  }
  return chosen;
};

module.exports = {
  LEGACY_DIR_NAME,
  DATA_MARKERS,
  chooseUserDataPath,
  hasUserData,
  adoptLegacyUserData,
};
