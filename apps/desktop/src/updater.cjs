// Update notifier. Unsigned macOS bundles cannot self-install updates
// (Squirrel.Mac refuses them), so instead of electron-updater we check the
// GitHub Releases API, tell the user when a newer version exists, and hand
// the .dmg download to the system browser. Works identically for signed
// builds; if the app ever ships signed this can be upgraded back to full
// auto-install without changing the UX entry points.

const { app, dialog, net, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const {
  RELEASES_LATEST_API,
  RELEASES_PAGE_URL,
  evaluateRelease,
} = require("./update-check.cjs");

const isKorean = () => {
  try {
    return app.getLocale().toLowerCase().startsWith("ko");
  } catch {
    return true;
  }
};

const STRINGS = {
  ko: {
    updateTitle: "업데이트 확인",
    updateAvailable: (v) => `Movie Desk ${v} 업데이트가 있습니다`,
    updateDetail: (cur, v) =>
      `현재 버전 ${cur} → 새 버전 ${v}\n\n다운로드를 누르면 브라우저에서 새 버전을 받습니다. 설치 후 첫 실행 전에 터미널에서 xattr -cr "/Applications/Movie Desk.app" 을 실행해야 할 수 있습니다.`,
    download: "다운로드",
    releaseNotes: "릴리즈 노트 보기",
    later: "나중에",
    skipThisVersion: "이 버전은 다시 알리지 않기",
    upToDate: "현재 최신 버전입니다",
    upToDateDetail: (v) => `Movie Desk ${v}`,
    checkFailed: "업데이트 확인에 실패했습니다",
    ok: "확인",
  },
  en: {
    updateTitle: "Check for Updates",
    updateAvailable: (v) => `Movie Desk ${v} is available`,
    updateDetail: (cur, v) =>
      `Current version ${cur} → new version ${v}\n\nDownload opens the new version in your browser. Before the first launch you may need to run: xattr -cr "/Applications/Movie Desk.app"`,
    download: "Download",
    releaseNotes: "Release notes",
    later: "Later",
    skipThisVersion: "Skip this version",
    upToDate: "You're up to date",
    upToDateDetail: (v) => `Movie Desk ${v}`,
    checkFailed: "Update check failed",
    ok: "OK",
  },
};

const t = () => (isKorean() ? STRINGS.ko : STRINGS.en);

// Skipped-version persistence — a startup prompt the user dismissed with
// "skip this version" stays silent until a newer version appears. Manual
// checks from the menu always show the result.
const stateFile = () => path.join(app.getPath("userData"), "update-state.json");

const loadSkippedVersion = () => {
  try {
    const value = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return typeof value?.skippedVersion === "string" ? value.skippedVersion : null;
  } catch {
    return null;
  }
};

const saveSkippedVersion = (version) => {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ skippedVersion: version }));
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: Main-process persistence failures belong in desktop logs.
    console.warn("[movie-desk-desktop] could not persist update state:", err?.message ?? err);
  }
};

const fetchLatestRelease = async () => {
  const response = await net.fetch(RELEASES_LATEST_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `MovieDesk/${app.getVersion()}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return response.json();
};

const showUpdateDialog = async (win, result, { fromStartup }) => {
  const s = t();
  const { response, checkboxChecked } = await dialog.showMessageBox(win ?? undefined, {
    type: "info",
    title: s.updateTitle,
    message: s.updateAvailable(result.latestVersion),
    detail: s.updateDetail(app.getVersion(), result.latestVersion),
    buttons: [s.download, s.releaseNotes, s.later],
    defaultId: 0,
    cancelId: 2,
    ...(fromStartup ? { checkboxLabel: s.skipThisVersion, checkboxChecked: false } : {}),
  });
  if (response === 0) void shell.openExternal(result.downloadUrl);
  else if (response === 1) void shell.openExternal(result.pageUrl ?? RELEASES_PAGE_URL);
  else if (fromStartup && checkboxChecked) saveSkippedVersion(result.latestVersion);
};

// interactive=true (menu click) always reports the outcome, including
// up-to-date and errors. Startup checks only surface an available update.
const checkForUpdates = async (win, { interactive = false } = {}) => {
  const s = t();
  let result;
  try {
    const release = await fetchLatestRelease();
    result = evaluateRelease({
      currentVersion: app.getVersion(),
      release,
      arch: process.arch,
    });
    if (result.status === "error") throw new Error(result.reason);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: Update-check diagnostics run outside the renderer UI.
    console.warn("[movie-desk-desktop] update check failed:", err?.message ?? err);
    if (interactive) {
      await dialog.showMessageBox(win ?? undefined, {
        type: "warning",
        title: s.updateTitle,
        message: s.checkFailed,
        detail: String(err?.message ?? err),
        buttons: [s.ok],
      });
    }
    return { status: "error" };
  }

  if (result.status === "current") {
    if (interactive) {
      await dialog.showMessageBox(win ?? undefined, {
        type: "info",
        title: s.updateTitle,
        message: s.upToDate,
        detail: s.upToDateDetail(app.getVersion()),
        buttons: [s.ok],
      });
    }
    return result;
  }

  if (!interactive && loadSkippedVersion() === result.latestVersion) {
    // biome-ignore lint/suspicious/noConsole: Update-check diagnostics run outside the renderer UI.
    console.log("[movie-desk-desktop] update", result.latestVersion, "available but skipped by user");
    return result;
  }
  await showUpdateDialog(win, result, { fromStartup: !interactive });
  return result;
};

// Startup check: packaged builds only (an unpackaged dev checkout has nothing
// to update), deferred so the window is visible first, then repeated every
// 4 hours for long-lived sessions. Failures log and never block startup.
const scheduleStartupCheck = (win) => {
  if (!app.isPackaged) return;
  const run = () => void checkForUpdates(win, { interactive: false }).catch(() => {});
  setTimeout(run, 5_000);
  const timer = setInterval(run, 4 * 60 * 60 * 1000);
  timer.unref?.();
};

// MOVIE_DESK_UPDATE_SMOKE=1: drive the real network + decision pipeline once, print
// the outcome as JSON, and exit — used to verify the feature end-to-end
// without a dialog (e.g. from CI or a terminal).
const runSmokeCheck = async () => {
  try {
    const release = await fetchLatestRelease();
    const result = evaluateRelease({
      currentVersion: process.env.MOVIE_DESK_UPDATE_SMOKE_VERSION ?? app.getVersion(),
      release,
      arch: process.arch,
    });
    // biome-ignore lint/suspicious/noConsole: Smoke mode reports to the terminal by design.
    console.log("[movie-desk-desktop] update smoke:", JSON.stringify(result));
    app.exit(result.status === "error" ? 1 : 0);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: Smoke mode reports to the terminal by design.
    console.error("[movie-desk-desktop] update smoke failed:", err?.message ?? err);
    app.exit(1);
  }
};

module.exports = { checkForUpdates, scheduleStartupCheck, runSmokeCheck };
