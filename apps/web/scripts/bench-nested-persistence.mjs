// Paired A5-scale persistence write measurement, without import/render/network cost.
// Run: node apps/web/scripts/bench-nested-persistence.mjs [output.json]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/web/package.json"));
const { chromium } = require("@playwright/test");
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))(
  "esbuild",
);
const baselineHash = process.argv[3] ?? "40e1c6d";
const baselineFiles = new Map(
  ["project-crdt", "timeline-crdt", "project-export"].map((name) => [
    name,
    execFileSync("git", ["show", `${baselineHash}:apps/web/src/persistence/${name}.ts`], {
      encoding: "utf8",
    }),
  ]),
);
const bundles = [];
for (const baseline of [true, false]) {
  const result = await build({
    stdin: {
      contents: `export { createProjectCrdt } from "./apps/web/src/persistence/project-crdt.ts";
        export { prepareStoredProject } from "./apps/web/src/persistence/project-io.ts";
        export { createEmptyProject } from "./packages/core/src/index.ts";
        export * as Y from "./apps/web/node_modules/yjs/dist/yjs.mjs";`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: baseline ? "Before" : "After",
    logLevel: "silent",
    alias: {
      "@movie-desk/core": resolve("packages/core/src/index.ts"),
      "@": resolve("apps/web/src"),
    },
    plugins: baseline
      ? [
          {
            name: "baseline",
            setup(plugin) {
              plugin.onLoad(
                { filter: /\/(project-crdt|timeline-crdt|project-export)\.ts$/ },
                (args) => ({
                  contents: baselineFiles.get(args.path.split("/").at(-1).replace(".ts", "")),
                  loader: "ts",
                  resolveDir: resolve("apps/web/src/persistence"),
                }),
              );
            },
          },
        ]
      : [],
  });
  bundles.push(result.outputFiles[0].text);
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const content of bundles) await page.addScriptTag({ content });
  const result = await page.evaluate(() => {
    const p = Before.createEmptyProject();
    const mediaLibrary = Array.from({ length: 1000 }, (_, i) => ({
      id: `asset-${i}`,
      name: `Asset ${i}`,
      kind: "image",
      mime: "image/png",
      durationMs: 0,
      importedAt: 0,
      opfsPath: `image-${i}.png`,
    }));
    const clips = mediaLibrary.map((asset, i) => ({
      id: `clip-${i}`,
      kind: "media",
      assetId: asset.id,
      start: i * 1000,
      duration: 1000,
      trimIn: 0,
      trimOut: 1000,
      speed: 1,
      effects: [],
      keyframes: [],
    }));
    const timeline = {
      ...p.timeline,
      duration: 1000000,
      tracks: p.timeline.tracks.map((track, i) => (i ? track : { ...track, clips })),
    };
    const project = { ...p, mediaLibrary, timelines: [timeline], timeline };
    const samples = { before: [], after: [] };
    const summary = (values) => {
      const sorted = values.toSorted((a, b) => a - b);
      return {
        p50Ms: sorted[Math.floor(sorted.length * 0.5)],
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      };
    };
    // Alternate order across six rounds, 10 warmups + 50 measured edits each.
    for (let round = 0; round < 6; round++) {
      for (const label of round % 2 ? ["after", "before"] : ["before", "after"]) {
        const api = label === "before" ? Before : After;
        const doc = new api.Y.Doc();
        const crdt = api.createProjectCrdt(doc);
        crdt.write(project);
        for (let edit = 0; edit < 60; edit++) {
          const input = { ...project, name: `Edit ${edit}` };
          const start = performance.now();
          crdt.write(input);
          if (edit >= 10) samples[label].push(performance.now() - start);
        }
        doc.destroy();
      }
    }
    return {
      assets: 1000,
      clips: 1000,
      samplesPerVariant: 300,
      baseline: "paired baseline persistence modules",
      scope: "Chromium synchronous validated Yjs write; no IDB/import/render timing",
      jsonBytes: new TextEncoder().encode(JSON.stringify(After.prepareStoredProject(project)))
        .byteLength,
      before: summary(samples.before),
      after: summary(samples.after),
    };
  });
  const json = JSON.stringify({ ...result, baseline: baselineHash }, null, 2);
  process.stdout.write(`${json}\n`);
  if (process.argv[2]) writeFileSync(process.argv[2], `${json}\n`);
} finally {
  await browser.close();
}
