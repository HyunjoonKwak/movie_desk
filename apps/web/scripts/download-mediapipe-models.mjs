#!/usr/bin/env node
// Pre-fetches MediaPipe models that are needed during automatic analysis but
// are not committed to git. Release packaging runs this script before the
// static web export so the desktop app never needs to fetch them at runtime.
//
// Re-run safely: a valid existing file is skipped unless --force is passed.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const force = argv.includes("--force");

const MODELS = [
  {
    name: "MediaPipe Face Landmarker (float16)",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    destination: resolve(here, "..", "public", "mediapipe", "models", "face_landmarker.task"),
    bytes: 3_758_596,
    sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
  },
];

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fmtMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const print = (message) => stdout.write(`${message}\n`);

const validFile = async (model) => {
  try {
    const info = await stat(model.destination);
    if (!info.isFile() || info.size !== model.bytes) return false;
    return digest(await readFile(model.destination)) === model.sha256;
  } catch {
    return false;
  }
};

const download = async (model) => {
  if (!force && (await validFile(model))) {
    print(`  ✓ ${model.name} (cached, ${fmtMb(model.bytes)})`);
    return;
  }

  await mkdir(dirname(model.destination), { recursive: true });
  const temporary = `${model.destination}.download`;
  await rm(temporary, { force: true });

  const response = await fetch(model.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`fetch ${model.url}: ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== model.bytes || digest(bytes) !== model.sha256) {
    throw new Error(`${model.name}: downloaded file failed size or checksum validation`);
  }

  await writeFile(temporary, bytes);
  await rename(temporary, model.destination);
  print(`  ↓ ${model.name} (${fmtMb(bytes.byteLength)})`);
};

const main = async () => {
  print("Preparing bundled MediaPipe models");
  for (const model of MODELS) await download(model);
  print("Done.");
};

main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
