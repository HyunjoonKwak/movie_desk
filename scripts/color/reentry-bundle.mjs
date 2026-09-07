import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const root = path.resolve(import.meta.dirname, "../..");
const stubs = new Set([
  "apps/web/src/ai/bg-remove.ts",
  "apps/web/src/effects/lut/lut-store.ts",
  "apps/web/src/media/source/resolve-media-source.ts",
  "apps/web/src/renderer/frame-source.ts",
  "apps/web/src/renderer/webcodecs-decoder.ts",
  "nanoid",
  "apps/web/src/export/bt709-worker-factory.ts",
]);
function modules(base) {
  const result = {};
  const visit = (file) => {
    if (result[file] || stubs.has(file)) return file;
    result[file] = "";
    const source = base
      ? execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8" })
      : readFileSync(path.join(root, file), "utf8");
    let js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    js = js.replace(/require\("([^"\n]+)"\)/g, (_, id) => {
      let resolved =
        id === "@movie-desk/core"
          ? "packages/core/src/index.ts"
          : id.startsWith("@/")
            ? `apps/web/src/${id.slice(2)}`
            : id.startsWith(".")
              ? path.posix.join(path.posix.dirname(file), id)
              : id;
      if (resolved !== "nanoid" && !resolved.endsWith(".ts"))
        resolved += existsSync(path.join(root, `${resolved}.ts`)) ? ".ts" : "/index.ts";
      visit(resolved);
      return `require(${JSON.stringify(resolved)})`;
    });
    result[file] = js;
    return file;
  };
  visit("apps/web/src/renderer/compositor.ts");
  visit("apps/web/src/export/bt709-frame.ts");
  visit("apps/web/src/export/bt709-pipeline.ts");
  return result;
}

// Same source-module loader used by the color audits. Only I/O and AI are
// stubbed; production compositor/shaders/color conversion execute on real GL.
export const reentryBundle = (base) => `(${install.toString()})(${JSON.stringify(modules(base))});`;
function install(compiled) {
  const sources = new Map();
  const decoded = new Map();
  const fixture = { sources, decoded, sourceHook: null, maskHook: null };
  const stubs = {
    "apps/web/src/ai/bg-remove.ts": {
      getSegmenter: async () => ({ segmentFor: (source) => fixture.maskHook?.(source) ?? null }),
    },
    "apps/web/src/effects/lut/lut-store.ts": {
      useLutStore: { getState: () => ({ getLut: () => undefined }) },
    },
    "apps/web/src/media/source/resolve-media-source.ts": { resolveMediaSource: async () => null },
    "apps/web/src/renderer/frame-source.ts": {
      FrameSourcePool: class {
        async get(asset) {
          if (fixture.sourceHook) await fixture.sourceHook(asset);
          return sources.get(asset.id) ?? null;
        }
        retain() {}
        dispose() {}
      },
    },
    "apps/web/src/renderer/webcodecs-decoder.ts": {
      getFrameProvider: () => ({
        retain() {},
        has: () => true,
        framesFor: (id, time) =>
          typeof decoded.get(id) === "function" ? decoded.get(id)(time) : (decoded.get(id) ?? null),
      }),
    },
    "apps/web/src/export/bt709-worker-factory.ts": {
      createBt709Worker: () => {
        throw new Error("Synchronous capture fixture");
      },
    },
    nanoid: { nanoid: () => "fixture-id" },
  };
  const cache = { ...stubs };
  const get = (id) => {
    if (cache[id]) return cache[id];
    const exports = {};
    cache[id] = exports;
    new Function("exports", "require", "module", compiled[id])(exports, get, { exports });
    return exports;
  };
  fixture.Compositor = get("apps/web/src/renderer/compositor.ts").Compositor;
  fixture.Capture = get("apps/web/src/export/bt709-frame.ts").Bt709FrameCapture;
  fixture.Pipeline = get("apps/web/src/export/bt709-pipeline.ts").Bt709FramePipeline;
  fixture.effects = get("apps/web/src/effects/registry.ts").listEffects();
  fixture.get = get;
  window.__reentry = fixture;
}
