// Keeps the app working offline: everything is cached on install and served from the cache.
// tools/build.mjs stamps VERSION with a hash of the app, so each deploy installs fresh files.

const VERSION = '1396663bffe8';
const CACHE = `superslow-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'schedule.js',
  'store.js',
  'audio.js',
  'wakelock.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/barlow-condensed-600.woff2',
  'fonts/barlow-400.woff2',
  'fonts/barlow-600.woff2',
  'sounds/index.json',
];

// Bypasses the browser's HTTP cache, so an install never picks up a stale file.
const fresh = (url) => new Request(url, { cache: 'reload' });

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map(fresh));
      const numbers = await (await cache.match('sounds/index.json')).json();
      await cache.addAll(numbers.map((n) => fresh(`sounds/${n}.wav`)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('superslow-') && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    (async () => (await caches.match(request, { ignoreSearch: true })) ?? fetch(request))(),
  );
});
