// Electron main process. Wraps the static-exported web app from
// ../web/out and serves it via a custom `app://` protocol so the service
// worker and SharedArrayBuffer (COOP/COEP) keep working.
//
// In dev mode (MOVIE_DESK_DEV_URL env var set) we point straight at the Next dev
// server so HMR works.

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { DesktopRelinker } = require("./desktop-relink.cjs");
const { createCatalogSnapshot, listCatalogSnapshots, restoreCatalogSnapshot } = require("./catalog-backup.cjs");
const { MediaCatalog } = require("./catalog.cjs");
const { MediaHelperClient } = require("./helper-client.cjs");
const { createDesktopImageImporter, isHeicMime } = require("./image-import.cjs");
const { createReferenceImporter, registerRootForFile } = require("./reference-import.cjs");
const { createConsolidator } = require("./consolidate.cjs");
let consolidator;
const { toDiskSourceRef } = require("./source-resolver.cjs");
let referenceImporter;
const { installMediaProtocol, MediaLeaseRegistry } = require("./media-protocol.cjs");
const { VolumeRootResolver } = require("./volume-root-resolver.cjs");
const { checkForUpdates, scheduleStartupCheck, runSmokeCheck } = require("./updater.cjs");
const { adoptLegacyUserData } = require("./user-data.cjs");

const isDev = !!process.env.MOVIE_DESK_DEV_URL;
const DEV_URL = process.env.MOVIE_DESK_DEV_URL ?? "http://localhost:3000/editor";

// Proper product name for the application menu / dock (package.json's
// lowercase `name` would otherwise leak into the UI).
app.setName("Movie Desk");
// Existing users have their projects under the pre-rename folder; keep
// using it in place, decided once and recorded (see user-data.cjs).
adoptLegacyUserData(app, fs, path, (message) => {
  // biome-ignore lint/suspicious/noConsole: the data location must be visible in the desktop log.
  console.warn(`[movie-desk-desktop] ${message}`);
});
// In a packaged build the web export lives at <Resources>/web (see
// electron-builder.yml `extraResources`). Unpackaged runs read from the
// repo's apps/web/out directory.
const WEB_OUT = app.isPackaged
  ? path.join(process.resourcesPath, "web")
  : path.join(__dirname, "..", "..", "web", "out");

// Privileged custom protocol — required so the service worker can register
// against it and SharedArrayBuffer is allowed (treated as secure context).
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      // Required for navigator.serviceWorker.register() to succeed on this
      // custom scheme — secure+standard alone aren't enough in Electron, so
      // without this the SW silently fails to register and offline caching
      // never works on desktop.
      allowServiceWorkers: true,
    },
  },
  {
    scheme: "media",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mediaCatalog;
let mediaHelper;
let volumeRootResolver;
let imageImporter;
let desktopRelinker;
let backupTimer;
let backupRunning;
let catalogFailure;
let restoringCatalog = false;
const catalogPath = () => path.join(app.getPath("userData"), "catalog", "media.sqlite3");
const backupDirectory = () => path.join(app.getPath("userData"), "catalog", "backups");
const mediaLeases = new MediaLeaseRegistry();

const mimeFromExt = (ext) => {
  const map = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".wasm": "application/wasm",
    ".tflite": "application/octet-stream",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".map": "application/json; charset=utf-8",
  };
  return map[ext] ?? "application/octet-stream";
};

// Resolve an `app://` URL into a file on disk under WEB_OUT. Next's static
// export emits trailing-slash directories with index.html, so we mirror that.
const resolveAppPath = (urlPath) => {
  // Strip query string, decode, normalise.
  let cleaned;
  try {
    cleaned = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  // Block path traversal.
  if (cleaned.includes("..")) return null;
  let rel = cleaned.replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  let target = path.join(WEB_OUT, rel);
  // An existing directory (e.g. `/editor` with no trailing slash, as the SW
  // caches it) must resolve to its index.html, or readFile throws EISDIR.
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, "index.html");
  } else if (!fs.existsSync(target) && !path.extname(target)) {
    // Fall back to <route>.html, else the SPA shell.
    if (fs.existsSync(`${target}.html`)) target = `${target}.html`;
    else target = path.join(WEB_OUT, "index.html");
  }
  return target;
};

// Window bounds persistence — restore the last size/position/maximized
// state across launches instead of resetting to the defaults every time.
const windowStateFile = () => path.join(app.getPath("userData"), "window-state.json");

const loadWindowState = () => {
  try {
    const value = JSON.parse(fs.readFileSync(windowStateFile(), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const state = {};
    if (Number.isFinite(value.width)) state.width = Math.min(10_000, Math.max(960, value.width));
    if (Number.isFinite(value.height)) state.height = Math.min(10_000, Math.max(600, value.height));
    if (Number.isFinite(value.x)) state.x = value.x;
    if (Number.isFinite(value.y)) state.y = value.y;
    state.maximized = value.maximized === true;
    return state;
  } catch {
    return null;
  }
};

const saveWindowState = (win) => {
  try {
    const bounds = win.getNormalBounds();
    fs.writeFileSync(
      windowStateFile(),
      JSON.stringify({ ...bounds, maximized: win.isMaximized() }),
    );
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: Main-process persistence failures belong in desktop logs.
    console.warn("[movie-desk-desktop] could not persist window state:", err?.message ?? err);
  }
};

const isTrustedRendererUrl = (url) => {
  try {
    if (isDev) return new URL(url).origin === new URL(DEV_URL).origin;
    const parsed = new URL(url);
    return parsed.protocol === "app:" && parsed.hostname === "cut-editor";
  } catch {
    return false;
  }
};

const requireTrustedIpc = (event) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url ?? "")) {
    throw new Error("untrusted media IPC sender");
  }
};

const createWindow = () => {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state?.width ?? 1440,
    height: state?.height ?? 900,
    ...(Number.isFinite(state?.x) && Number.isFinite(state?.y) ? { x: state.x, y: state.y } : {}),
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#15191e",
    titleBarStyle: "hiddenInset",
    // Center the traffic lights vertically in the web app's 44px top bar.
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Hand the app version to the sandboxed preload synchronously so the
      // web top bar can show it from the first paint.
      additionalArguments: [`--movie-desk-version=${app.getVersion()}`],
    },
  });
  if (state?.maximized) win.maximize();
  win.on("close", () => saveWindowState(win));
  // A playback URL is a project-session capability, not a permanent path.
  win.on("closed", () => mediaLeases.releaseAll());

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Keep the legacy host: Chromium storage is origin-scoped, so changing it
    // would hide existing projects and OPFS media after the product rename.
    win.loadURL("app://cut-editor/editor/");
  }

  const openExternal = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
      void shell.openExternal(parsed.toString()).catch((err) => {
        // biome-ignore lint/suspicious/noConsole: External-browser failures belong in desktop logs.
        console.warn("[movie-desk-desktop] could not open external link:", err?.message ?? err);
      });
    } catch {
      // Invalid URLs are intentionally denied.
    }
  };

  // Popups never get an Electron renderer. Web links go to the system browser;
  // file/custom schemes are denied.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  return win;
};

const initializeMediaInfrastructure = async () => {
  const catalogDirectory = path.join(app.getPath("userData"), "catalog");
  await fs.promises.mkdir(catalogDirectory, { recursive: true });
  try {
    mediaCatalog = new MediaCatalog(path.join(catalogDirectory, "media.sqlite3"));
    await mediaCatalog.ready();
  } catch (error) {
    if (mediaCatalog) await mediaCatalog.close().catch(() => {});
    mediaCatalog = undefined;
    catalogFailure = error;
    // A rebuildable catalog failure must not prevent legacy OPFS projects from opening.
    // biome-ignore lint/suspicious/noConsole: The renderer will add a recovery UI in C2.
    console.warn("[movie-desk-desktop] media catalog unavailable; continuing degraded:", error);
  }
  mediaHelper = new MediaHelperClient();
  volumeRootResolver = new VolumeRootResolver({ helper: mediaHelper });
  if (mediaCatalog) {
    desktopRelinker = new DesktopRelinker({ catalog: mediaCatalog, helper: mediaHelper });
    let failures = 0;
    let warned = false;
    backupTimer = setInterval(() => {
      void snapshotCatalog().then(() => { failures = 0; }).catch(() => {
        if (++failures >= 3 && !warned) {
          warned = true;
          void dialog.showMessageBox({ type: "warning", message: "Catalog backups could not be saved",
            detail: "Three scheduled backups failed. Check free disk space and access to the app data folder, then use File → Back up media catalog to retry. Original media are unchanged." });
        }
      });
    }, 15 * 60_000);
    backupTimer.unref();
    imageImporter = createDesktopImageImporter({
      catalog: mediaCatalog,
      helper: mediaHelper,
      cacheDirectory: path.join(app.getPath("userData"), "cache", "image-previews"),
    });
    referenceImporter = createReferenceImporter({
      catalog: mediaCatalog,
      helper: mediaHelper,
      toDiskSourceRef,
    });
    consolidator = createConsolidator({
      catalog: mediaCatalog,
      helper: mediaHelper,
      resolveSource: (asset) => resolveCatalogSource(asset),
      registerRootFor: (filePath) =>
        registerRootForFile({ catalog: mediaCatalog, helper: mediaHelper }, filePath),
    });
  }
  installMediaProtocol(protocol, {
    catalog: { getAsset: (assetId) => mediaCatalog?.getAsset(assetId) ?? null },
    leases: mediaLeases,
    resolveSource: (asset) => resolveCatalogSource(asset),
  });
};

const resolveCatalogSource = async (asset) => {
  const resolved = await volumeRootResolver.resolve(asset);
  if (mediaCatalog) {
    await mediaCatalog.recordSourceState(asset.id, resolved.state);
    if (resolved.state === "online") {
      const segments = asset.relativePath.split(path.sep).length;
      const rootPath = await fs.promises.realpath(path.resolve(resolved.absolutePath, ...Array(segments).fill("..")));
      if (rootPath !== await fs.promises.realpath(asset.root.lastKnownAbsolutePath).catch(() => asset.root.lastKnownAbsolutePath)) {
        const root = await mediaCatalog.getRoot(asset.rootId);
        await mediaCatalog.registerRoot({ ...root, lastKnownAbsolutePath: rootPath });
      }
    }
  }
  return resolved;
};

const snapshotCatalog = async () => {
  if (!mediaCatalog || restoringCatalog) throw new Error("Catalog is unavailable");
  if (!backupRunning) backupRunning = createCatalogSnapshot(mediaCatalog, backupDirectory()).then((result) => { lastSnapshotAt = Date.now(); return result; }).finally(() => { backupRunning = undefined; });
  return backupRunning;
};

const restoreCatalog = async (win) => {
  if (restoringCatalog) return;
  restoringCatalog = true;
  try {
    const names = await listCatalogSnapshots(backupDirectory());
    if (names.length === 0) { dialog.showErrorBox("Catalog backup", "No saved catalog snapshot is available."); return; }
    const selected = await dialog.showOpenDialog(win, { title: "Choose a catalog snapshot", defaultPath: path.join(backupDirectory(), names[0]), properties: ["openFile"], filters: [{ name: "Catalog snapshots", extensions: ["sqlite3"] }] });
    if (selected.canceled || !selected.filePaths[0]) return;
    const snapshotPath = selected.filePaths[0];
    const choice = await dialog.showMessageBox(win, {
      type: "warning", title: "Restore catalog backup", message: "Restore this catalog snapshot?",
      detail: `${path.basename(snapshotPath)}\nCatalog changes after this snapshot will be lost. The current catalog is preserved for recovery. Original media and project files are not changed. The app will restart.`,
      buttons: ["Cancel", "Restore and restart"], defaultId: 0, cancelId: 0,
    });
    if (choice.response !== 1) return;
    clearInterval(backupTimer);
    if (backupRunning) await backupRunning.catch(() => {});
    const previous = mediaCatalog;
    mediaCatalog = undefined;
    desktopRelinker = undefined;
    imageImporter = undefined;
    referenceImporter = undefined;
    consolidator = undefined;
    mediaLeases.releaseAll();
    if (previous) await previous.close();
    try {
      await restoreCatalogSnapshot({ databasePath: catalogPath(), snapshotPath, confirmed: true });
    } catch (error) {
      // Reopen the rolled-back catalog in a fresh process.
      dialog.showErrorBox("Catalog could not be restored", "The snapshot could not be read. Your previous catalog and original media are preserved. Restart the app to reopen the previous catalog.");
      app.relaunch();
      app.quit();
      return;
    }
    app.relaunch();
    app.quit();
  } finally { restoringCatalog = false; }
};

ipcMain.handle("movie-desk:media-relink-choose", async (event, assetIds, folder = false) => {
  requireTrustedIpc(event);
  if (!desktopRelinker || restoringCatalog) throw new Error("Catalog unavailable; restore a catalog backup from the File menu");
  if (!Array.isArray(assetIds) || assetIds.length === 0 || assetIds.some((id) => typeof id !== "string")) throw new Error("Invalid asset selection");
  if (assetIds.length > 1000) return { tooMany: true };
  const win = BrowserWindow.fromWebContents(event.sender);
  const chosen = await dialog.showOpenDialog(win, { properties: [folder ? "openDirectory" : "openFile"], title: folder ? "Reconnect missing files by relative path" : "Reconnect original file" });
  if (chosen.canceled || !chosen.filePaths[0]) return [];
  try {
    return folder ? await desktopRelinker.prepareFolder(assetIds, chosen.filePaths[0], event.sender.id, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send("movie-desk:media-relink-progress", progress);
      })
      : [await desktopRelinker.prepare(assetIds[0], chosen.filePaths[0], event.sender.id)];
  } catch (error) {
    if (error.name === "AbortError") return [];
    if (["capacity", "timeout"].includes(error.code)) return { error: error.code };
    throw new Error("Cannot read that file or its media type differs. Check access and choose it again.");
  }
});

ipcMain.handle("movie-desk:media-relink-cancel", (event) => {
  requireTrustedIpc(event);
  desktopRelinker?.cancel(event.sender.id);
});

ipcMain.handle("movie-desk:media-relink-commit", async (event, token, confirmed) => {
  requireTrustedIpc(event);
  if (!desktopRelinker || restoringCatalog) throw new Error("Catalog is unavailable");
  try {
    const result = await desktopRelinker.commit(token, confirmed, event.sender.id);
    mediaLeases.releaseAsset(result.assetId);
    volumeRootResolver.clear();
    return result;
  } catch { throw new Error("Could not reconnect. The file or catalog may have changed; choose the file again and confirm its fingerprint."); }
});

ipcMain.handle("movie-desk:media-acquire", async (event, assetId) => {
  requireTrustedIpc(event);
  if (!mediaCatalog) return { state: "offline", reason: "catalog-unavailable" };
  const asset = await mediaCatalog.getAsset(assetId);
  if (!asset) return null;
  const resolved = await resolveCatalogSource(asset);
  if (resolved.state !== "online" && resolved.state !== "moved") {
    return { state: resolved.state, ...(resolved.reason ? { reason: resolved.reason } : {}) };
  }
  if (isHeicMime(asset.mime) && imageImporter) {
    const preview = await imageImporter.acquireEditingPreview(asset, resolved);
    return {
      ...mediaLeases.acquire(asset.id, {
        asset: { id: asset.id, ...preview.asset },
        resolved: { state: "online", absolutePath: preview.absolutePath },
      }),
      state: resolved.state,
    };
  }
  return { ...mediaLeases.acquire(asset.id, { asset, resolved }), state: resolved.state };
});

// The destination is chosen through a native folder picker so the renderer
// never names a path itself.
ipcMain.handle("movie-desk:media-consolidate-root", async (event, rootId) => {
  requireTrustedIpc(event);
  if (!consolidator || !mediaCatalog) {
    return { ok: false, error: { code: "CATALOG_UNAVAILABLE", message: "The local media catalog is unavailable." } };
  }
  if (typeof rootId !== "string") throw new Error("Invalid root");
  const assetIds = await mediaCatalog.assetIdsForRoot(rootId);
  const chosen = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  if (chosen.canceled || !chosen.filePaths[0]) {
    return { ok: false, error: { code: "CANCELLED", message: "No destination was chosen." } };
  }
  try {
    return { ok: true, result: await consolidator.consolidate(assetIds, chosen.filePaths[0]) };
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "CONSOLIDATE_FAILED";
    return { ok: false, error: { code, message: "Movie Desk could not gather these files." } };
  }
});

ipcMain.handle("movie-desk:media-consolidate", async (event, assetIds) => {
  requireTrustedIpc(event);
  if (!consolidator) {
    return { ok: false, error: { code: "CATALOG_UNAVAILABLE", message: "The local media catalog is unavailable." } };
  }
  const chosen = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  if (chosen.canceled || !chosen.filePaths[0]) return { ok: false, error: { code: "CANCELLED", message: "No destination was chosen." } };
  try {
    const result = await consolidator.consolidate(assetIds, chosen.filePaths[0]);
    return { ok: true, result };
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "CONSOLIDATE_FAILED";
    return { ok: false, error: { code, message: "Movie Desk could not gather these files." } };
  }
});

ipcMain.handle("movie-desk:media-source-roots", async (event) => {
  requireTrustedIpc(event);
  if (!mediaCatalog) return [];
  const roots = await mediaCatalog.listRoots();
  // The absolute path is what makes a root recognisable to its owner, and this
  // channel is the one place it is meant to be shown. Nothing else exposes it.
  return roots.map((root) => ({
    id: root.id,
    kind: root.kind,
    displayPath: root.lastKnownAbsolutePath,
    assetCount: root.assetCount,
    totalBytes: root.totalBytes,
    state: root.state,
    ...(root.displayName ? { displayName: root.displayName } : {}),
  }));
});

ipcMain.handle("movie-desk:media-root-assets", async (event, rootId) => {
  requireTrustedIpc(event);
  if (!mediaCatalog) return [];
  if (typeof rootId !== "string") throw new Error("Invalid root");
  return mediaCatalog.assetIdsForRoot(rootId);
});

ipcMain.handle("movie-desk:media-rename-root", async (event, rootId, displayName) => {
  requireTrustedIpc(event);
  if (!mediaCatalog) return false;
  if (typeof rootId !== "string") throw new Error("Invalid root");
  // An empty name clears the override and falls back to the folder name.
  const trimmed = typeof displayName === "string" ? displayName.trim().slice(0, 120) : "";
  await mediaCatalog.renameRoot(rootId, trimmed || null);
  return true;
});

ipcMain.handle("movie-desk:media-import-file", async (event, sourcePath) => {
  requireTrustedIpc(event);
  if (!referenceImporter) {
    return {
      ok: false,
      error: { code: "CATALOG_UNAVAILABLE", message: "The local media catalog is unavailable." },
    };
  }
  try {
    return { ok: true, asset: await referenceImporter.importFile(sourcePath) };
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "IMPORT_FAILED";
    return { ok: false, error: { code, message: safeReferenceImportMessage(code) } };
  }
});

const safeReferenceImportMessage = (code) => {
  if (code === "PERMISSION_DENIED") return "Movie Desk does not have permission to read this file.";
  if (code === "SOURCE_NOT_FOUND") return "The selected file is no longer available.";
  if (code === "UNSUPPORTED_FORMAT") return "This file type is not referenced in place.";
  if (code === "NOT_A_FILE") return "The selected item is not a file.";
  if (code === "CATALOG_UNAVAILABLE") return "The local media catalog is unavailable.";
  return "Movie Desk could not read this file.";
};

ipcMain.handle("movie-desk:media-import-heic", async (event, sourcePath) => {
  requireTrustedIpc(event);
  if (!imageImporter) {
    return {
      ok: false,
      error: { code: "CATALOG_UNAVAILABLE", message: "The local media catalog is unavailable." },
    };
  }
  try {
    return { ok: true, asset: await imageImporter.importHeicFile(sourcePath) };
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "IMPORT_FAILED";
    return {
      ok: false,
      error: {
        code,
        message: safeImageImportMessage(code),
      },
    };
  }
});

const safeImageImportMessage = (code) => {
  if (code === "PERMISSION_DENIED") return "Movie Desk does not have permission to read this file.";
  if (code === "SOURCE_NOT_FOUND") return "The selected file is no longer available.";
  if (code === "UNSUPPORTED_FORMAT") return "This HEIC/HEIF variant is not supported.";
  if (code === "CATALOG_UNAVAILABLE") return "The local media catalog is unavailable.";
  return "Movie Desk could not inspect or preview this HEIC/HEIF file.";
};

ipcMain.handle("movie-desk:media-release", (event, leaseId) => {
  requireTrustedIpc(event);
  if (typeof leaseId !== "string") return false;
  return mediaLeases.release(leaseId);
});

ipcMain.handle("movie-desk:media-last-source-states", async (event, ids) => {
  requireTrustedIpc(event);
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some((id) => typeof id !== "string")) throw new Error("Invalid assets");
  return mediaCatalog ? mediaCatalog.lastSourceStates(ids) : {};
});

ipcMain.handle("movie-desk:media-source-state", async (event, assetId) => {
  requireTrustedIpc(event);
  if (!mediaCatalog) {
    return {
      state: "offline",
      reason: "catalog-unavailable",
    };
  }
  const asset = await mediaCatalog.getAsset(assetId);
  if (!asset) return { state: "offline" };
  const resolved = await resolveCatalogSource(asset);
  // Paths remain main-process-only. The renderer only receives actionable state.
  return {
    state: resolved.state,
    ...(resolved.reason ? { reason: resolved.reason } : {}),
    ...(resolved.candidates ? { candidateCount: resolved.candidates.length } : {}),
  };
});

const installAppProtocol = () => {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    const target = resolveAppPath(url.pathname);
    if (!target || !fs.existsSync(target)) {
      return new Response("Not found", { status: 404 });
    }
    const body = await fs.promises.readFile(target);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": mimeFromExt(path.extname(target).toLowerCase()),
        // Match the web app's COOP/COEP so SharedArrayBuffer + wasm threads work.
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    });
  });
};

// Inject COOP/COEP on the dev server's responses too — Next's dev middleware
// already does this but the Electron session sometimes drops them, so be
// explicit. (For HTTP origins; the app:// handler sets them above.)
const installDevHeaders = () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith("http://localhost")) return callback({});
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Cross-Origin-Opener-Policy": ["same-origin"],
        "Cross-Origin-Embedder-Policy": ["require-corp"],
      },
    });
  });
};

const buildMenu = (win) => {
  const isMac = process.platform === "darwin";
  const send = (channel) => () => win.webContents.send(channel);
  const checkUpdatesLabel = app.getLocale().toLowerCase().startsWith("ko")
    ? "업데이트 확인…"
    : "Check for Updates…";
  const checkUpdatesItem = {
    label: checkUpdatesLabel,
    click: () => void checkForUpdates(win, { interactive: true }),
  };
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              checkUpdatesItem,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Export…",
          accelerator: "CmdOrCtrl+E",
          click: send("menu:export"),
        },
        {
          label: "Save snapshot",
          accelerator: "CmdOrCtrl+S",
          click: send("menu:snapshot"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
        { type: "separator" },
        { label: "Back up media catalog", click: async () => {
          try { await snapshotCatalog(); await dialog.showMessageBox(win, { message: "Catalog backup saved", detail: "A snapshot was saved in the app data folder. Original media files are not included." }); }
          catch { dialog.showErrorBox("Catalog backup failed", "The catalog could not be backed up. Check available disk space and try again."); }
        } },
        { label: "Restore media catalog…", click: () => void restoreCatalog(win) },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Project on GitHub",
          click: () => shell.openExternal("https://github.com/HyunjoonKwak/movie_desk"),
        },
        ...(isMac ? [] : [checkUpdatesItem]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

// IPC: native save dialog used by the export pipeline. The renderer hands
// us the encoded bytes + a suggested file name; we open a Save panel and,
// on confirm, write the file to the chosen location. Returns the absolute
// path written, or null when the user cancelled.
ipcMain.handle("movie-desk:save-export", async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { suggestedName, bytes, mimeType } = payload ?? {};
  if (!bytes || !(bytes instanceof Uint8Array)) {
    throw new Error("movie-desk:save-export expects bytes:Uint8Array");
  }
  const ext = typeof suggestedName === "string" ? path.extname(suggestedName).slice(1) : "";
  const filters = ext ? [{ name: mimeType ?? ext.toUpperCase(), extensions: [ext] }] : [];
  const result = await dialog.showSaveDialog(win ?? undefined, {
    defaultPath: typeof suggestedName === "string" ? suggestedName : undefined,
    filters,
  });
  if (result.canceled || !result.filePath) return null;
  await fs.promises.writeFile(result.filePath, Buffer.from(bytes));
  savedExports.add(result.filePath);
  return result.filePath;
});

// Only files this process wrote through the save panel can be revealed, so
// the renderer cannot point Finder at arbitrary paths.
const savedExports = new Set();
ipcMain.handle("movie-desk:reveal-export", async (_event, filePath) => {
  if (typeof filePath !== "string" || !savedExports.has(filePath)) return false;
  if (!fs.existsSync(filePath)) return false;
  shell.showItemInFolder(filePath);
  return true;
});

// IPC: YouTube music-credit lookup for the music library. Main has no CORS,
// so it can read the watch page the renderer cannot. Read-only metadata —
// the renderer parses the returned text with its own credits parser.
const { creditsTextFromWatchHtml, isAllowedYoutubeUrl } = require("./music-credits.cjs");

ipcMain.handle("movie-desk:fetch-music-credits", async (_event, url) => {
  if (!isAllowedYoutubeUrl(url)) return null;
  try {
    const res = await fetch(String(url), {
      signal: AbortSignal.timeout(8000),
      // English UI labels keep the structured rows parseable regardless of
      // the machine's locale (the parser understands ko labels too).
      headers: { "accept-language": "en" },
    });
    // Redirects are followed — re-verify the FINAL origin stayed on the
    // allowlist before reading the body, and cap it (watch pages ~1-2MB).
    if (!res.ok || !isAllowedYoutubeUrl(res.url)) return null;
    const html = await res.text();
    if (html.length > 5_000_000) return null;
    return creditsTextFromWatchHtml(html);
  } catch {
    return null;
  }
});

app.whenReady().then(async () => {
  // MOVIE_DESK_UPDATE_SMOKE=1 drives the update check once and exits (no window).
  if (process.env.MOVIE_DESK_UPDATE_SMOKE === "1") {
    void runSmokeCheck();
    return;
  }
  try {
    await initializeMediaInfrastructure();
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: Startup failures need a desktop diagnostic trail.
    console.error("[movie-desk-desktop] could not initialize media catalog:", error);
    dialog.showErrorBox(
      "Movie Desk could not start",
      "The local media catalog could not be opened. Your original media was not changed.",
    );
    app.quit();
    return;
  }
  // Headless-ish runtime probe: verifies Electron's bundled Node can open the
  // worker-owned node:sqlite catalog and register the streaming protocol.
  if (process.env.MOVIE_DESK_MEDIA_SMOKE === "1") {
    // biome-ignore lint/suspicious/noConsole: CI consumes this smoke marker.
    console.log("[movie-desk-desktop] media infrastructure ready");
    if (mediaCatalog) await mediaCatalog.close();
    await mediaHelper.close();
    app.quit();
    return;
  }
  installDevHeaders();
  if (!isDev) installAppProtocol();
  const win = createWindow();
  buildMenu(win);
  if (catalogFailure && catalogFailure.code !== "CATALOG_TOO_NEW") {
    void dialog.showMessageBox(win, { type: "warning", message: "The media catalog could not be opened", detail: "Original files are unchanged. Restore a saved catalog from File → Restore media catalog, or keep working with available project media.", buttons: ["Continue", "Restore catalog…"], defaultId: 0, cancelId: 0 }).then(({ response }) => { if (response === 1) void restoreCatalog(win); });
  }
  scheduleStartupCheck(win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let shutdownComplete = false;
let shuttingDown = false;
let lastSnapshotAt = 0;
app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(backupTimer);
  void Promise.race([new Promise((resolve) => setTimeout(resolve, 4_000)), (async () => {
    if (mediaCatalog && !restoringCatalog && Date.now() - lastSnapshotAt > 5 * 60_000) await snapshotCatalog().catch(() => {});
    mediaLeases.releaseAll();
    if (mediaCatalog) await mediaCatalog.close();
    if (mediaHelper) await mediaHelper.close();
  })()]).catch(() => {}).finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});

// Diagnostic helper for verifying the bundle in CI.
// biome-ignore lint/suspicious/noConsole: Desktop boot paths are verified from main-process logs.
console.log("[movie-desk-desktop] booting", {
  isDev,
  devUrl: DEV_URL,
  webOut: WEB_OUT,
  exists: fs.existsSync(WEB_OUT),
});
