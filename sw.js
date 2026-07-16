/**
 * Service worker for ติดตามเรียนพิเศษ - Tutor Dispatch PWA.
 * Strategy:
 *  - App shell (index.html, manifest, this file): network-first, falls back to
 *    cache only when offline. (Was cache-first — meant a returning user with
 *    an already-installed SW would NEVER see a new deploy, since nothing ever
 *    re-fetched index.html once it was cached once. This app ships updates
 *    often; staleness is a worse failure mode than one extra network hop.)
 *  - GAS API calls (anything to a URL containing '/exec' or '/macros/'): network-first,
 *    falling back to cache for GET reads when offline. POSTs are NOT cached here —
 *    offline POST queueing/retry is handled in index.html (localStorage queue),
 *    this SW only helps GET reads work offline.
 *
 * IMPORTANT: bump CACHE_NAME (vN -> vN+1) whenever you change this file, so
 * browsers that already have an old service worker installed detect the
 * byte-level change, cycle through install/activate again, and clear the old
 * cache via the activate handler below. Without a bump, an already-cached
 * client's SW registration looks byte-identical and never re-installs.
 */

const CACHE_NAME = 'tutor-dispatch-v2';
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

  // App shell: network-first, so a deployed update is visible on next load
  // for anyone online — falls back to cache only when the fetch itself fails.
  event.respondWith(
    fetch(req).then(function (res) {
      const resClone = res.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(req, resClone); });
      return res;
    }).catch(function () {
      return caches.match(req);
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
