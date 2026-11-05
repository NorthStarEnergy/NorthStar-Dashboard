// Service worker for the contractor check-in app.
//
// Scope is deliberately narrow: cache the shell so the page still opens with no
// signal, and stay entirely out of the way of everything else.
//
// It never touches /api/. Check-in, heartbeat, help and checkout all reach the
// network directly or fail visibly. A worker who taps NEED HELP NOW must see it
// fail so they call the control room instead — a request quietly queued by a
// service worker would tell someone help is on the way when nothing was sent.

const CACHE = 'northstar-checkin-v4-manual-safety';
const SHELL = [
  '/contractor-checkin.html',
  '/manifest.webmanifest',
  '/icons/northstar-192.png',
  '/icons/northstar-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Anything that changes safety state, and anything off-origin, is left alone.
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  // This worker is registered at the origin root so the installable check-in
  // app works, but it must never cache or serve the operator dashboard.
  if (!SHELL.includes(url.pathname)) return;

  // Network first: a worker should get the current page whenever there is signal.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then(hit => hit || caches.match('/contractor-checkin.html')))
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows => {
    const worker=windows.find(client=>new URL(client.url).pathname==='/contractor-checkin.html');
    return worker?worker.focus():clients.openWindow('/contractor-checkin.html');
  }));
});
