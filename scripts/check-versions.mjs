#!/usr/bin/env node
// Version policy (work order D2): apps/desktop/package.json is the canonical
// release version because it is what the DMG, the in-app badge and the GitHub
// Release are named after. The other manifests must match it.
//
//   node scripts/check-versions.mjs          # exit 1 and list drift
//   node scripts/check-versions.mjs --write  # rewrite drifted manifests
//
// Photo Desk keeps the same guard (scripts/check-versions.mjs there).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CANONICAL = "apps/desktop/package.json";
export const FOLLOWERS = ["package.json", "apps/web/package.json", "packages/core/package.json"];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// Returns { ok, canonical, mismatched: [{ file, version }] }. With `write`,
// drifted manifests are rewritten in place (only the version field changes)
// and the result reflects the state after writing.
export const checkVersions = (root, { write = false } = {}) => {
  const canonical = readJson(resolve(root, CANONICAL)).version;
  const mismatched = [];
  for (const file of FOLLOWERS) {
    const path = resolve(root, file);
    const raw = readFileSync(path, "utf8");
    const pkg = JSON.parse(raw);
    if (pkg.version === canonical) continue;
    if (!write) {
      mismatched.push({ file, version: pkg.version });
      continue;
    }
    // Replace only the version line so formatting and key order survive.
    const rewritten = raw.replace(/("version":\s*")[^"]*(")/, `$1${canonical}$2`);
    writeFileSync(path, rewritten);
  }
  return { ok: mismatched.length === 0, canonical, mismatched };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const write = process.argv.includes("--write");
  const result = checkVersions(root, { write });
  if (result.ok) {
    process.stdout.write(`versions in sync: ${result.canonical}${write ? " (written)" : ""}\n`);
    process.exit(0);
  }
  process.stderr.write(`versions drifted from ${CANONICAL} (${result.canonical}):\n`);
  for (const m of result.mismatched) process.stderr.write(`  ${m.file}: ${m.version}\n`);
  process.stderr.write("run `pnpm sync:versions` to rewrite them.\n");
  process.exit(1);
}
