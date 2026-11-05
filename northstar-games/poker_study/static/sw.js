const CACHE='northstar-offline-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/offline.html')));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
// Never cache hands, APIs, or action requests. Online play always uses the server.
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate'&&event.request.method==='GET'){event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));}});
