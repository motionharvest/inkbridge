// Keeps the app itself on the device, so Inkbridge opens with no server.
// The space and its waiting changes are kept separately, in IndexedDB (see
// js/local.js); this worker keeps only the files that make up the app and
// the pasted images the device has shown.
//
// The app's files are fetched from the server first, so a change to the app
// shows on the next open. When the server does not answer within a moment,
// the saved copy opens instead. Pasted images never change (their names are
// hashes of their bytes), so the saved copy is used whenever there is one.
//
// A browser runs a service worker only on HTTPS or on localhost.

const CACHE = 'inkbridge-app';
const SHELL = [
  '/',
  '/style.css',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-512.png',
  '/socket.io/socket.io.esm.min.js',
  '/js/app.js',
  '/js/board.js',
  '/js/colorpicker.js',
  '/js/erase.js',
  '/js/lasso.js',
  '/js/local.js',
  '/js/outbox.js',
  '/js/render.js',
  '/js/smooth.js',
  '/js/svg.js',
  '/js/shared/ops.js',
];
// How long to wait for the server before opening the saved copy. A device
// on another network may wait far longer than this for a server it cannot
// reach.
const SERVER_WAIT_MS = 2500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/assets/')) return event.respondWith(savedFirst(request));
  // Socket.IO's own requests are the live connection, not part of the app.
  if (url.pathname.startsWith('/socket.io/') && !url.pathname.endsWith('.js')) return;
  event.respondWith(serverFirst(request));
});

async function serverFirst(request) {
  const cache = await caches.open(CACHE);
  // The page is saved once, at `/`; the space code in its address changes.
  const key = request.mode === 'navigate' ? '/' : request;
  try {
    const response = await withTimeout(fetch(request), SERVER_WAIT_MS);
    if (response.ok) cache.put(key, response.clone());
    return response;
  } catch {
    const saved = await cache.match(key, { ignoreSearch: true });
    if (saved) return saved;
    throw new Error(`${request.url} is not saved on this device.`);
  }
}

async function savedFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('The server did not answer.')), ms)),
  ]);
}
