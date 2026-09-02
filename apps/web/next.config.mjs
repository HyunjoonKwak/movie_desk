import { readFileSync } from "node:fs";

/** @type {import('next').NextConfig} */
const isExport = process.env.NEXT_OUTPUT === "export";

// Product version single source: apps/desktop/package.json. Baked in at build
// time for browser/PWA use; the Electron bridge (window.cutDesktop.version)
// overrides it at runtime in the desktop app.
const appVersion = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8"))
      .version;
  } catch {
    return "";
  }
})();

const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: appVersion },
  reactStrictMode: true,
  // Playwright starts a Turbopack dev server after the production build in CI.
  // Keep those incompatible caches separate so the dev server never tries to
  // reuse a production `.next` tree.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@movie-desk/core"],
  // The desktop bundle ships a static `out/` directory served by Electron;
  // web deploys keep the standard `next start` flow with header support.
  ...(isExport ? { output: "export", trailingSlash: true, images: { unoptimized: true } } : {}),
  experimental: {
    // SharedArrayBuffer needed by ffmpeg.wasm; set COOP/COEP headers in middleware.
  },
  // `headers()` is a no-op in static export — the Electron shell injects the
  // same COOP/COEP headers on every response so SharedArrayBuffer keeps working.
  ...(isExport
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/(.*)",
              headers: [
                { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
                { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
