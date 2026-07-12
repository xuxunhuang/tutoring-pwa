/**
 * Service worker for ติดตามเรียนพิเศษ - Tutor Dispatch PWA.
 * Strategy:
 *  - App shell (index.html, manifest, this file): cache-first, falls back to network.
 *  - GAS API calls (anything to a URL containing '/exec' or '/macros/'): network-first,
 *    falling back to cache for GET reads when offline. POSTs are NOT cached here —
 *    offline POST queueing/retry is handled in index.html (localStorage queue),
 *    this SW only helps GET reads work offline.
 */

const CACHE_NAME = 'tutor-dispatch-v1';
const APP_SHELL = [
  './index.html',
  './manifest.webmanifest'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function isApiRequest(url) {
  return url.indexOf('/exec') !== -1 || url.indexOf('/macros/') !== -1 || url.indexOf('script.google.com') !== -1;
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  const url = req.url;

  if (isApiRequest(url)) {
    if (req.method !== 'GET') {
      // Let POSTs go straight to network; the page itself handles offline queueing.
      return;
    }
    // Network-first for API GETs, fallback to cache.
    event.respondWith(
      fetch(req).then(function (res) {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, resClone); });
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  // App shell: cache-first.
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, resClone); });
        return res;
      }).catch(function () {
        return cached;
      });
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
