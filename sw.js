const CACHE_VERSION = "biksafe-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./src/app.js",
  "./src/camera.js",
  "./src/config.js",
  "./src/detector.js",
  "./src/feedback.js",
  "./src/overlay.js",
  "./src/preferences.js",
  "./src/reliability.js",
  "./src/settings-panel.js",
  "./src/ui.js",
  "./src/wake-lock.js",
];

const CACHEABLE_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "tfhub.dev",
  "storage.googleapis.com",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  const shouldCache =
    url.origin === self.location.origin ||
    CACHEABLE_HOSTS.has(url.hostname);

  if (!shouldCache) {
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  if (cached) {
    void fetchAndStore(cache, request);
    return cached;
  }

  return fetchAndStore(cache, request);
}

async function fetchAndStore(cache, request) {
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}
