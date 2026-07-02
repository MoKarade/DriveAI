// Service worker MINIMAL (installabilité PWA) : passe-plat réseau, aucun cache applicatif —
// l'app est un client temps réel des API Google, un cache serait un piège de fraîcheur.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* passe-plat : le réseau fait foi */ });
