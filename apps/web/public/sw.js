// movie_desk service worker — app-shell caching with a network-first strategy
// for navigation and stale-while-revalidate for static assets. Media blobs
// live in OPFS and are never cached here.

const CACHE = "movie-desk-v3";
const APP_SHELL = [
  "/",
  "/editor",
  "/manifest.webmanifest",
  "/icon.svg",
  "/fonts/PretendardVariable.woff2",
];
const MAX_STATIC_ENTRIES = 80;

const cacheSuccessful = async (request, response) => {
  if (!response.ok) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/_next/")) return;
  const staticKeys = (await cache.keys()).filter((key) =>
    new URL(key.url).pathname.startsWith("/_next/"),
  );
  await Promise.all(staticKeys.slice(0, -MAX_STATIC_ENTRIES).map((key) => cache.delete(key)));
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first, fall back to cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          await cacheSuccessful(req, res);
          return res;
        })
        .catch(() => caches.match(req).then((r) => r ?? caches.match("/editor"))),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (url.pathname.startsWith("/_next/") || APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then(async (res) => {
            await cacheSuccessful(req, res);
            return res;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
  }
});
