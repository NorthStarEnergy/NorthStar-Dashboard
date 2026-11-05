// The operator companion is installable, but deliberately online-only.
// No fetch handler means this worker cannot cache, replay, or queue an API call.
// A stale field or outage state must never look like current control-room data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
