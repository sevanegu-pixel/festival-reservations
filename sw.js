// Appli Réservations du festival : rien n'est mis en cache, tout passe par le réseau (le lien personnel reste dans l'appareil).
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function () {});
