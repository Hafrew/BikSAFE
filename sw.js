const CACHE_VERSION = "biksafe-v10-experimental-models";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./privacy.html",
  "./styles.css",
  "./src/app.js",
  "./src/camera.js",
  "./src/candidate-engine.js",
  "./src/candidate-worker.js",
  "./src/config.js",
  "./src/detection-filter.js",
  "./src/detector.js",
  "./src/efficientdet-adapter.js",
  "./src/feedback.js",
  "./src/frame-timing.js",
  "./src/inference-engine.js",
  "./src/inference-worker.js",
  "./src/overlay.js",
  "./src/preferences.js",
  "./src/range.js",
  "./src/runtime-diagnostics.js",
  "./src/rfdetr-adapter.js",
  "./src/reliability.js",
  "./src/settings-panel.js",
  "./src/scene-quality.js",
  "./src/threat.js",
  "./src/tracking.js",
  "./src/ui.js",
  "./src/wake-lock.js",
  "./src/worker-frame.js",
  "./src/vendor/rfdetr-host.js",
];

const CACHEABLE_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "tfhub.dev",
  "storage.googleapis.com",
]);
const APP_SHELL_PATHS = new Set(
  APP_SHELL.map((path) => new URL(path, self.location.href).pathname),
);

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
    (url.origin === self.location.origin && APP_SHELL_PATHS.has(url.pathname)) ||
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
    return cached;
  }

  return fetchAndStore(cache, request);
}

async function fetchAndStore(cache, request) {
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
  }
  return response;
}
