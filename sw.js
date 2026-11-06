/**
 * Unravel PWA Service Worker
 * Provides offline caching, lightning-fast performance, and installation capabilities.
 */

const CACHE_NAME = 'unravel-pwa-v1.2.0';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './builder/index.html',
  './manifest.webmanifest',
  './config.json',
  './assets/css/style.css',
  './assets/js/app.js',
  './assets/js/security.js',
  './assets/js/validators.js',
  './assets/js/builder.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-solo.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/vendor/bootstrap/bootstrap.min.css',
  './assets/vendor/bootstrap/bootstrap.bundle.min.js',
  './assets/vendor/bootstrap-icons/bootstrap-icons.min.css',
  './assets/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2',
  './assets/vendor/bootstrap-icons/fonts/bootstrap-icons.woff',
  './assets/vendor/sweetalert2/sweetalert2.min.css',
  './assets/vendor/sweetalert2/sweetalert2.all.min.js',
  './assets/vendor/papaparse/papaparse.min.js',
  './assets/vendor/xlsx/xlsx.full.min.js',
  './assets/vendor/dayjs/dayjs.min.js',
  './assets/vendor/dayjs/customParseFormat.js',
  './assets/sample-data/user-info.json',
  './assets/sample-data/sample-project.json',
  './assets/sample-data/starter-templates.json',
  './assets/sample-data/sample-patients.csv',
  './assets/sample-data/sample-clients.csv'
];

// Install: Precaches the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use map with individual catches so precaching never blocks on optional assets
      const cachePromises = PRECACHE_ASSETS.map(async (url) => {
        try {
          const response = await fetch(url);
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch (err) {
          console.warn(`[PWA SW] Precache skipped for ${url}:`, err);
        }
      });
      await Promise.all(cachePromises);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up previous cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strategy depending on request type
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle HTTP/HTTPS GET requests
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // 1. Navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          // Fallback to index.html if navigating offline
          return caches.match('./index.html');
        })
    );
    return;
  }

  // 2. Static assets (CSS, JS, Fonts, Images, Icons)
  const isStaticAsset = url.pathname.includes('/assets/') ||
                        url.pathname.endsWith('.css') ||
                        url.pathname.endsWith('.js') ||
                        url.pathname.endsWith('.svg') ||
                        url.pathname.endsWith('.png') ||
                        url.pathname.endsWith('.woff2') ||
                        url.pathname.endsWith('.woff');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached, and revalidate in background
          fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
            }
          }).catch(() => {/* Offline */});
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. Data & Config files: Network First with Cache Fallback
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ offline: true, error: "Network unavailable" }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
  );
});

