// Caches the app shell so the tracker opens instantly and survives a flaky
// connection. Marking a chapter read still needs the network: nothing here
// queues writes.
const VERSION = 'horner-v1';
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.js',
  '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return; // straight to the network
  }

  // Stale while revalidate: show the cached shell now, pick up a new deploy
  // on the next load.
  event.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => cached);
    return cached ?? network;
  }));
});
