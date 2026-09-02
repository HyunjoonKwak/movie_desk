// Pure update-check logic — no Electron imports so it stays unit-testable
// with plain `node --test`. The Electron glue (network, dialogs, menu) lives
// in updater.cjs.

const RELEASES_LATEST_API = "https://api.github.com/repos/HyunjoonKwak/movie_desk/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/HyunjoonKwak/movie_desk/releases/latest";

// Numeric semver compare on the x.y.z prefix; prerelease suffixes and a
// leading "v" are tolerated ("v0.3.0-beta" → [0,3,0]). Returns <0, 0, >0.
const compareVersions = (a, b) => {
  const parse = (v) =>
    String(v ?? "")
      .replace(/^v/i, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

// electron-builder names the arm64 artifact `Movie Desk-x.y.z-arm64.dmg` and the
// Intel one plain `Movie Desk-x.y.z.dmg` (no arch suffix). Blockmaps and yml
// metadata must never be offered as downloads.
const pickDmgAsset = (assets, arch) => {
  const dmgs = (assets ?? []).filter((a) => a?.name?.endsWith(".dmg"));
  if (dmgs.length === 0) return null;
  const wantArm = arch === "arm64";
  const match = dmgs.find((a) => a.name.includes("-arm64.dmg") === wantArm);
  return match ?? dmgs[0];
};

// Turn a GitHub `releases/latest` payload into an update decision.
const evaluateRelease = ({ currentVersion, release, arch }) => {
  const latestVersion = String(release?.tag_name ?? "").replace(/^v/i, "");
  if (!latestVersion) return { status: "error", reason: "no tag_name in release" };
  if (compareVersions(latestVersion, currentVersion) <= 0) {
    return { status: "current", latestVersion };
  }
  const asset = pickDmgAsset(release?.assets, arch);
  return {
    status: "update",
    latestVersion,
    downloadUrl: asset?.browser_download_url ?? release?.html_url ?? RELEASES_PAGE_URL,
    pageUrl: release?.html_url ?? RELEASES_PAGE_URL,
    notes: typeof release?.body === "string" ? release.body : "",
  };
};

module.exports = {
  RELEASES_LATEST_API,
  RELEASES_PAGE_URL,
  compareVersions,
  pickDmgAsset,
  evaluateRelease,
};
