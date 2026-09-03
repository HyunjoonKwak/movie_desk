// Pure update-check logic — no Electron imports so it stays unit-testable
// with plain `node --test`. The Electron glue (network, dialogs, menu) lives
// in updater.cjs.

const RELEASES_LATEST_API = "https://api.github.com/repos/HyunjoonKwak/movie_desk/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/HyunjoonKwak/movie_desk/releases/latest";

// Semver compare: numeric x.y.z first, then the prerelease rule — a version
// without a suffix is newer than the same x.y.z with one ("0.4.0" >
// "0.4.0-rc.1"), and suffix identifiers compare numerically when both are
// numbers, else as strings ("rc.2" > "rc.1", "rc.10" > "rc.2"). A leading
// "v" is tolerated. Returns <0, 0, >0.
const parseVersion = (v) => {
  const [core = "", pre = ""] = String(v ?? "")
    .replace(/^v/i, "")
    .split("-", 2);
  return {
    numbers: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease: pre ? pre.split(".") : [],
  };
};

const compareIdentifiers = (a, b) => {
  const na = /^\d+$/.test(a) ? Number.parseInt(a, 10) : null;
  const nb = /^\d+$/.test(b) ? Number.parseInt(b, 10) : null;
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1; // numeric identifiers sort before alphanumeric ones
  if (nb !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

const compareVersions = (a, b) => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa.numbers[i] ?? 0) - (pb.numbers[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  const length = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < length; i++) {
    const ia = pa.prerelease[i];
    const ib = pb.prerelease[i];
    if (ia === undefined) return -1; // shorter prerelease is older ("rc" < "rc.1")
    if (ib === undefined) return 1;
    const diff = compareIdentifiers(ia, ib);
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
