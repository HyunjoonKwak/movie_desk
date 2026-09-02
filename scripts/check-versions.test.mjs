import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkVersions } from "./check-versions.mjs";

// A throwaway workspace with the four manifests the policy covers.
const workspace = (versions) => {
  const root = mkdtempSync(join(tmpdir(), "movie-desk-versions-"));
  const write = (rel, version) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), `${JSON.stringify({ name: rel, version }, null, 2)}\n`);
  };
  write("apps/desktop/package.json", versions.desktop);
  write("package.json", versions.root);
  write("apps/web/package.json", versions.web);
  write("packages/core/package.json", versions.core);
  return root;
};

test("passes when every manifest matches the desktop version", () => {
  const root = workspace({ desktop: "0.4.0", root: "0.4.0", web: "0.4.0", core: "0.4.0" });
  const result = checkVersions(root);
  assert.equal(result.ok, true);
  assert.equal(result.canonical, "0.4.0");
  assert.deepEqual(result.mismatched, []);
});

test("reports every manifest that drifted from the desktop version", () => {
  const root = workspace({ desktop: "0.4.0", root: "0.1.0", web: "0.4.0", core: "0.1.0" });
  const result = checkVersions(root);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.mismatched.map((m) => m.file),
    ["package.json", "packages/core/package.json"],
  );
});

test("--write rewrites drifted manifests without touching anything else", () => {
  const root = workspace({ desktop: "0.4.0", root: "0.1.0", web: "0.4.0", core: "0.1.0" });
  const result = checkVersions(root, { write: true });
  assert.equal(result.ok, true);
  const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(rootPkg.version, "0.4.0");
  assert.equal(rootPkg.name, "package.json"); // other fields survive
  assert.equal(checkVersions(root).ok, true);
});
