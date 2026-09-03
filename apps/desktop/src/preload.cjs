// Preload script. Exposes a small, typed bridge between the Electron main
// process (native menus, save dialog) and the web app's renderer.
//
// The web app stays origin-agnostic: it listens for `movie-desk:menu-export`
// and `movie-desk:menu-snapshot`, which the bridge re-dispatches from IPC.

const { contextBridge, ipcRenderer, webUtils } = require("electron");

const forward = (channel, eventName) => {
  ipcRenderer.on(channel, () => {
    window.dispatchEvent(new CustomEvent(eventName));
  });
};

forward("menu:export", "movie-desk:menu-export");
forward("menu:snapshot", "movie-desk:menu-snapshot");

// The installed app's version, passed by main.cjs via additionalArguments.
const versionArg = process.argv.find((arg) => arg.startsWith("--movie-desk-version="));

contextBridge.exposeInMainWorld("cutDesktop", {
  // Marker the web app can check to enable desktop-only paths if needed.
  isDesktop: true,
  // App version shown in the web top bar (e.g. "0.2.3").
  version: versionArg ? versionArg.slice("--movie-desk-version=".length) : null,
  // Native save dialog → returns the chosen file path, or null on cancel.
  // Accepts a Uint8Array of encoded bytes; the main process writes the file.
  saveExport: async (payload) => ipcRenderer.invoke("movie-desk:save-export", payload),
  // Shows a file saved through saveExport in Finder. Resolves false otherwise.
  revealExport: async (filePath) => ipcRenderer.invoke("movie-desk:reveal-export", filePath),
  // YouTube music-credit text for the music library (desktop only — main
  // process fetch has no CORS). Returns parseable text or null.
  fetchMusicCredits: async (url) => ipcRenderer.invoke("movie-desk:fetch-music-credits", url),
  media: {
    // Returns an opaque, revocable media:// URL. Absolute source paths never
    // cross the context-isolated preload boundary.
    acquirePlaybackUrl: async (assetId) => ipcRenderer.invoke("movie-desk:media-acquire", assetId),
    releasePlaybackUrl: async (leaseId) => ipcRenderer.invoke("movie-desk:media-release", leaseId),
    sourceState: async (assetId) => ipcRenderer.invoke("movie-desk:media-source-state", assetId),
    // Resolve the native path inside the isolated preload and send it directly
    // to main. The absolute path is never returned to page JavaScript.
    importHeicFile: async (file) =>
      ipcRenderer.invoke("movie-desk:media-import-heic", webUtils.getPathForFile(file)),
  },
});
