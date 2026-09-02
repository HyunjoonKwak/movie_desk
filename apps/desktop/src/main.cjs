// Electron main process. Wraps the static-exported web app from
// ../web/out and serves it via a custom `app://` protocol so the service
// worker and SharedArrayBuffer (COOP/COEP) keep working.
//
// In dev mode (MOVIE_DESK_DEV_URL env var set) we point straight at the Next dev
// server so HMR works.

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { checkForUpdates, scheduleStartupCheck, runSmokeCheck } = require("./updater.cjs");

const isDev = !!process.env.MOVIE_DESK_DEV_URL;
const DEV_URL = process.env.MOVIE_DESK_DEV_URL ?? "http://localhost:3000/editor";

// Proper product name for the application menu / dock (package.json's
// lowercase `name` would otherwise leak into the UI).
app.setName("Movie Desk");
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
]);

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

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Keep the legacy host: Chromium storage is origin-scoped, so changing it
    // would hide existing projects and OPFS media after the product rename.
    win.loadURL("app://cut-editor/editor/");
  }

  const isTrustedNavigation = (url) => {
    try {
      if (isDev) return new URL(url).origin === new URL(DEV_URL).origin;
      const parsed = new URL(url);
      return parsed.protocol === "app:" && parsed.hostname === "cut-editor";
    } catch {
      return false;
    }
  };
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
    if (isTrustedNavigation(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  return win;
};

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
  return result.filePath;
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

app.whenReady().then(() => {
  // MOVIE_DESK_UPDATE_SMOKE=1 drives the update check once and exits (no window).
  if (process.env.MOVIE_DESK_UPDATE_SMOKE === "1") {
    void runSmokeCheck();
    return;
  }
  installDevHeaders();
  if (!isDev) installAppProtocol();
  const win = createWindow();
  buildMenu(win);
  scheduleStartupCheck(win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Diagnostic helper for verifying the bundle in CI.
// biome-ignore lint/suspicious/noConsole: Desktop boot paths are verified from main-process logs.
console.log("[movie-desk-desktop] booting", {
  isDev,
  devUrl: DEV_URL,
  webOut: WEB_OUT,
  exists: fs.existsSync(WEB_OUT),
});
